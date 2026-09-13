/**
 * 案件レーダーの本体。
 *
 *   取得（providers） -> ハードフィルタ -> LLM採点（capabilities）
 *     -> 保存（store） -> Slack（report）
 *
 * 終了コードの代わりに hadFetchFailure を返す。呼び出し側（API / CLI）が
 * それを見て警告を出す。取得失敗を「新着ゼロ」に丸めないための約束。
 */

import { evaluateAll, hardFilter, type Dropped, type Scored } from "@/lib/capabilities/evaluate";
import { loadCriteria, type Criteria } from "@/lib/config";
import { ExampleProvider } from "@/lib/providers/example";
import type { FetchResult, JobProvider, RawJob } from "@/lib/providers/types";
import { todayJst } from "@/lib/providers/types";
import { buildDroppedDetail, buildText, rateLabel } from "@/lib/report";
import { postMessage, slackConfigured } from "@/lib/slack";
import { FileStore, MemoryStore, PrismaStore, type Store } from "@/lib/store";

/**
 * 使う取得 provider。
 *
 * 既定は fixtures を読むだけの ExampleProvider。
 * 自分の環境で動かすときは、ここに自分の provider を並べる。
 */
export const buildProviders = (_criteria: Criteria): JobProvider[] => [new ExampleProvider()];

export type RadarMode = "run" | "preview" | "doctor";

export type RadarResult = {
  date: string;
  fetchResults: Record<string, FetchResult>;
  scored: Scored[];
  dropped: Dropped[];
  failures: { job: RawJob; error: string }[];
  hadFetchFailure: boolean;
  text?: string;
  notified: number;
};

async function collect(
  providers: JobProvider[],
  store: Store,
  log: (s: string) => void,
): Promise<{ fetchResults: Record<string, FetchResult>; jobs: RawJob[] }> {
  const fetchResults: Record<string, FetchResult> = {};
  const jobs: RawJob[] = [];

  for (const provider of providers) {
    const seen = await store.seenUids(provider.name);
    let result: FetchResult;
    try {
      result = await provider.fetch(seen);
    } catch (e) {
      // provider 自体の想定外の落ち方も failed として持ち上げる
      result = {
        status: "failed",
        jobs: [],
        checked: 0,
        error: `provider が例外: ${String(e)}`,
        sources: [],
      };
    }
    fetchResults[provider.name] = result;
    if (result.status === "ok") jobs.push(...result.jobs);
    await store.saveFetchLog(provider.name, result);
    log(
      `${provider.name.padEnd(9)} ${result.status.padEnd(15)} new=${String(result.jobs.length).padEnd(3)} ` +
        `checked=${String(result.checked).padEnd(4)} ${(result.error ?? "").slice(0, 110)}`,
    );
  }
  return { fetchResults, jobs };
}

export async function runRadar(
  opts: {
    mode?: RadarMode;
    skipLlm?: boolean;
    /** 媒体名で絞る（provider.name）。採点し直したい媒体だけ回すため */
    only?: string;
    /** 採点する件数を絞る（動作確認用） */
    limit?: number;
    providers?: JobProvider[];
    store?: Store;
    log?: (s: string) => void;
  } = {},
): Promise<RadarResult> {
  const mode = opts.mode ?? "run";
  const log = opts.log ?? (() => {});
  // run のとき、DATABASE_URL があれば DB に、無ければファイルに保存する。
  // DB を用意しなくても「毎朝Slackに届く」が成立するようにするため。
  const store =
    opts.store ??
    (mode === "run"
      ? process.env.DATABASE_URL
        ? new PrismaStore()
        : new FileStore()
      : new MemoryStore());

  const criteria = loadCriteria();
  const all = opts.providers ?? buildProviders(criteria);
  const providers = opts.only ? all.filter((p) => p.name === opts.only) : all;
  if (opts.only && providers.length === 0) {
    throw new Error(
      `--only ${opts.only} に一致する媒体が無い（${all.map((p) => p.name).join(" / ")}）`,
    );
  }
  const date = todayJst();

  log("=== 取得 ===");
  const collected = await collect(providers, store, log);
  const { fetchResults } = collected;
  const jobs = opts.limit ? collected.jobs.slice(0, opts.limit) : collected.jobs;
  if (opts.limit) log(`（--limit ${opts.limit} により ${collected.jobs.length}件から絞った）`);
  const hadFetchFailure = Object.values(fetchResults).some((r) => r.status === "failed");
  log(`\n新規案件 ${jobs.length}件`);

  if (mode === "doctor") {
    return { date, fetchResults, scored: [], dropped: [], failures: [], hadFetchFailure, notified: 0 };
  }

  // LLM を呼ばないモード。ハードフィルタの効きだけ見る（無料）
  if (opts.skipLlm) {
    const dropped: Dropped[] = [];
    const kept: RawJob[] = [];
    for (const job of jobs) {
      const r = hardFilter(job, criteria.hard);
      if (r.pass) kept.push(job);
      else dropped.push({ job, reason: r.reason });
    }
    log(`\n=== ハードフィルタ ===\n通過 ${kept.length}件 / 除外 ${dropped.length}件`);
    for (const d of dropped) log(`  除外  ${(d.job.title ?? "").slice(0, 46).padEnd(46)} ${d.reason}`);
    for (const j of kept) {
      log(`  通過  ${(j.title ?? "").slice(0, 46).padEnd(46)} ${rateLabel(j)} / ${j.remote ?? "リモート度不明"}`);
    }
    return { date, fetchResults, scored: [], dropped, failures: [], hadFetchFailure, notified: 0 };
  }

  log("\n=== LLM採点 ===");
  const { scored, dropped, failures } = await evaluateAll(jobs, criteria);
  for (const s of scored) {
    const m = s.match;
    log(
      `  [${String(m.totalPct).padStart(3)}%] 適合${String(m.fitPct).padStart(3)}% × 通過${String(m.passPct).padStart(3)}%  ` +
        `${(s.job.title ?? "").slice(0, 40).padEnd(40)} ${s.evaluation.verdict.slice(0, 50)}`,
    );
  }
  for (const f of failures) log(`  失敗  ${f.job.uid}: ${f.error}`);

  await store.saveDropped(dropped);
  await store.saveScored(scored);
  await store.saveFailures(failures);

  const text = buildText({
    date,
    fetchResults,
    scored,
    dropped,
    failures,
    notifyTotalMin: criteria.hard.notifyTotalMin,
  });

  let notified = 0;
  if (mode === "run") {
    const channel = process.env.SLACK_CHANNEL_ID;
    if (!slackConfigured() || !channel) {
      throw new Error("SLACK_BOT_TOKEN / SLACK_CHANNEL_ID が未設定のため通知できない");
    }
    const { ts } = await postMessage(channel, text);
    const detail = buildDroppedDetail(dropped);
    if (detail && ts) await postMessage(channel, detail, ts);

    const hits = scored.filter((s) => s.match.totalPct >= criteria.hard.notifyTotalMin);
    await store.markNotified(hits);
    notified = hits.length;
  }

  return { date, fetchResults, scored, dropped, failures, hadFetchFailure, text, notified };
}
