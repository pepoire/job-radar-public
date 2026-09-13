/**
 * 保存層。DB がある本番と、DB を触らない手元プレビューを同じ口で扱う。
 *
 * 重複排除は Job の @@unique([source, uid]) に任せる。
 * Python 版のように seen リストを自前で持たない。
 */

import fs from "node:fs";
import path from "node:path";

import type { Dropped, Scored } from "@/lib/capabilities/evaluate";
import type { FetchResult, RawJob } from "@/lib/providers/types";

export interface Store {
  /** 既に見た uid（媒体ごと）。これに無いものだけ詳細を取りに行く */
  seenUids(provider: string): Promise<Set<string>>;
  saveFetchLog(provider: string, result: FetchResult): Promise<void>;
  saveScored(items: Scored[]): Promise<void>;
  saveDropped(items: Dropped[]): Promise<void>;
  saveFailures(items: { job: RawJob; error: string }[]): Promise<void>;
  markNotified(items: Scored[]): Promise<void>;
}

/**
 * DB を用意せずに動かすための保存層。
 * 重複排除に必要な「見たID」と、その日の結果を state/ と out/ に書く。
 * GitHub Actions が state/ をコミットして持ち越すので、毎日同じ案件は届かない。
 *
 * 一覧UIは Prisma を読むので、この store で動かしているあいだ画面には出ない
 * （Slack だけ。画面も使いたくなったら DATABASE_URL を設定して PrismaStore に切り替える）。
 */
export class FileStore implements Store {
  constructor(private readonly root = process.cwd()) {}

  private seenPath() {
    return path.join(this.root, "state", "seen.json");
  }

  private readSeen(): Record<string, string[]> {
    try {
      return JSON.parse(fs.readFileSync(this.seenPath(), "utf8")) as Record<string, string[]>;
    } catch {
      return {};
    }
  }

  async seenUids(provider: string): Promise<Set<string>> {
    return new Set(this.readSeen()[provider] ?? []);
  }

  async saveFetchLog(provider: string, result: FetchResult): Promise<void> {
    if (result.status !== "ok") return;
    const all = this.readSeen();
    const prev = all[provider] ?? [];
    // 取得できた媒体だけ進める。失敗した媒体を進めると復旧後に取りこぼす
    const now = result.jobs.map((j) => j.uid);
    // 直近2000件だけ保持。無限に増やさない
    all[provider] = [...new Set([...now, ...prev])].slice(0, 2000);
    fs.mkdirSync(path.dirname(this.seenPath()), { recursive: true });
    fs.writeFileSync(this.seenPath(), `${JSON.stringify(all, null, 1)}\n`);
  }

  private appendOut(key: string, value: unknown): void {
    const dir = path.join(this.root, "out");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.json`);
    const cur = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
    cur[key] = value;
    fs.writeFileSync(file, `${JSON.stringify(cur, null, 1)}\n`);
  }

  async saveScored(items: Scored[]): Promise<void> {
    this.appendOut("scored", items);
  }
  async saveDropped(items: Dropped[]): Promise<void> {
    this.appendOut("dropped", items);
  }
  async saveFailures(items: { job: RawJob; error: string }[]): Promise<void> {
    this.appendOut("failures", items);
  }
  async markNotified(items: Scored[]): Promise<void> {
    this.appendOut("notified", items.map((i) => i.job.uid));
  }
}

/** 手元プレビュー用。何も保存しないので毎回「全部新規」になる。 */
export class MemoryStore implements Store {
  async seenUids(): Promise<Set<string>> {
    return new Set();
  }
  async saveFetchLog(): Promise<void> {}
  async saveScored(): Promise<void> {}
  async saveDropped(): Promise<void> {}
  async saveFailures(): Promise<void> {}
  async markNotified(): Promise<void> {}
}

const remoteOrUnclear = (r: RawJob["remote"]) => r ?? "UNCLEAR";

/** 本番用。Prisma を使う。 */
export class PrismaStore implements Store {
  // 動的 import にして、DATABASE_URL が無い環境で読み込むだけで落ちないようにする
  private async client() {
    const { prisma } = await import("@/lib/db");
    return prisma;
  }

  async seenUids(provider: string): Promise<Set<string>> {
    const prisma = await this.client();
    const rows = await prisma.job.findMany({
      where: { source: provider },
      select: { uid: true },
    });
    return new Set(rows.map((r) => r.uid));
  }

  async saveFetchLog(provider: string, result: FetchResult): Promise<void> {
    const prisma = await this.client();
    await prisma.fetchLog.create({
      data: {
        provider,
        status: result.status.toUpperCase() as never,
        checked: result.checked,
        newCount: result.jobs.length,
        error: result.error ?? null,
      },
    });
  }

  private baseData(job: RawJob) {
    return {
      source: job.source,
      sourceLabel: job.sourceLabel ?? null,
      sourceChannel: job.channel ?? null,
      uid: job.uid,
      url: job.url,
      title: job.title,
      postedOn: job.postedOn ?? null,
      monthlyJpy: job.monthlyJpy ?? null,
      hourlyJpy: job.hourlyJpy ?? null,
      remote: remoteOrUnclear(job.remote) as never,
      minDaysPerWeek: job.minDaysPerWeek ?? null,
      startOn: job.startOn ?? null,
      hasSettlement: job.hasSettlement ?? false,
      settlementMinHours: job.settlementMinHours ?? null,
      settlementMaxHours: job.settlementMaxHours ?? null,
      negotiationCount: job.negotiationCount ?? null,
      paymentSiteDays: job.paymentSiteDays ?? null,
      station: job.station ?? null,
      requiredSkills: job.requiredSkills ?? null,
      welcomeSkills: job.welcomeSkills ?? null,
      roleText: job.roleText ?? null,
      body: job.body ?? null,
    };
  }

  async saveScored(items: Scored[]): Promise<void> {
    const prisma = await this.client();
    for (const { job, evaluation: e, match, model, filterNote } of items) {
      const judged = {
        stage: "SCORED" as never,
        // 落とさずに採点した案件の「引っかかった点」。無ければ消す
        filterNote: filterNote ?? null,
        fitPct: match.fitPct,
        passPct: match.passPct,
        totalPct: match.totalPct,
        fitBreakdown: match.fitBreakdown,
        passBreakdown: match.passBreakdown,
        requirementsTotal: e.requirementsTotal,
        requirementsMet: e.requirementsMet,
        requirementsMissing: e.requirementsMissing,
        domainExperience: e.domainExperience,
        domainRequired: e.domainRequired,
        absoluteBlockers: e.absoluteBlockers,
        aiCore: e.aiCore,
        pmValue: e.pmValue,
        verdict: e.verdict,
        reasons: e.reasons,
        concerns: e.concerns,
        remoteReading: e.remoteReading as never,
        monthlyReading: e.monthlyReading,
        stackOverlap: e.stackOverlap,
        model,
        scoredAt: new Date(),
      };
      await prisma.job.upsert({
        where: { source_uid: { source: job.source, uid: job.uid } },
        create: { ...this.baseData(job), ...judged },
        update: judged,
      });
    }
  }

  async saveDropped(items: Dropped[]): Promise<void> {
    const prisma = await this.client();
    for (const { job, reason } of items) {
      const judged = { stage: "DROPPED" as never, dropReason: reason };
      await prisma.job.upsert({
        where: { source_uid: { source: job.source, uid: job.uid } },
        create: { ...this.baseData(job), ...judged },
        update: judged,
      });
    }
  }

  async saveFailures(items: { job: RawJob; error: string }[]): Promise<void> {
    const prisma = await this.client();
    for (const { job, error } of items) {
      const judged = { stage: "FAILED" as never, dropReason: error.slice(0, 500) };
      await prisma.job.upsert({
        where: { source_uid: { source: job.source, uid: job.uid } },
        create: { ...this.baseData(job), ...judged },
        update: judged,
      });
    }
  }

  async markNotified(items: Scored[]): Promise<void> {
    const prisma = await this.client();
    const now = new Date();
    for (const { job } of items) {
      await prisma.job.update({
        where: { source_uid: { source: job.source, uid: job.uid } },
        data: { notifiedAt: now },
      });
    }
  }
}
