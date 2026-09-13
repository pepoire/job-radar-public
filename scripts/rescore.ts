/**
 * 採点済みの案件の％だけを計算し直す。
 *
 *   pnpm rescore          全件（LLMは呼ばない）
 *   pnpm rescore --dry    書き込まず差分だけ出す
 *
 * なぜ要るか
 *   ％の重み付けは lib/scoring.ts にあり、LLM の出力（数えた結果）は DB に残っている。
 *   重みを直したときに LLM を呼び直すのは無駄なので、保存済みの材料から計算し直す。
 *   ハードフィルタの条件（NGワードの照合範囲など）を直したときの
 *   filterNote もここで付け直す。どちらも LLM を呼ばない計算だから。
 *   逆に、プロンプトを直したとき（懸念の書き方など）は再採点が必要なのでこれでは足りない。
 */

import { hardFilter, noHardDrop } from "../src/lib/capabilities/evaluate";
import { computeFit, computePass } from "../src/lib/scoring";
import { loadCriteria } from "../src/lib/config";
import type { Evaluation } from "../src/lib/llm/schema";
import type { RawJob } from "../src/lib/providers/types";

import { loadEnv } from "./env";

loadEnv();

const dry = process.argv.includes("--dry");

async function main(): Promise<void> {
  const { hard } = loadCriteria();
  const { prisma } = await import("../src/lib/db");

  const jobs = await prisma.job.findMany({
    where: { stage: "SCORED", requirementsTotal: { not: null } },
    orderBy: { totalPct: "desc" },
  });
  console.log(`対象 ${jobs.length}件\n`);

  let changed = 0;

  for (const job of jobs) {
    // 保存してある LLM の出力を組み直す。ここで推測で埋めない
    const ev: Evaluation = {
      verdict: job.verdict ?? "",
      requirementsTotal: job.requirementsTotal ?? 0,
      requirementsMet: job.requirementsMet ?? 0,
      requirementsMissing: (job.requirementsMissing as string[]) ?? [],
      domainExperience: (job.domainExperience as Evaluation["domainExperience"]) ?? "NONE",
      // 既存の行には保存されていない。保存されるまでは「求められていない」として扱う
      domainRequired: job.domainRequired ?? false,
      absoluteBlockers: (job.absoluteBlockers as Evaluation["absoluteBlockers"]) ?? ["NONE"],
      aiCore: (job.aiCore as Evaluation["aiCore"]) ?? "NONE",
      pmValue: (job.pmValue as Evaluation["pmValue"]) ?? "NONE",
      remoteReading: (job.remoteReading as Evaluation["remoteReading"]) ?? "UNCLEAR",
      monthlyReading: job.monthlyReading,
      stackOverlap: (job.stackOverlap as string[]) ?? [],
      reasons: (job.reasons as string[]) ?? [],
      concerns: (job.concerns as string[]) ?? [],
    };

    const raw = {
      source: job.source,
      ...(job.sourceChannel ? { channel: job.sourceChannel as RawJob["channel"] } : {}),
      uid: job.uid,
      url: job.url,
      title: job.title,
      ...(job.monthlyJpy != null ? { monthlyJpy: job.monthlyJpy } : {}),
      ...(job.hourlyJpy != null ? { hourlyJpy: job.hourlyJpy } : {}),
      ...(job.minDaysPerWeek != null ? { minDaysPerWeek: job.minDaysPerWeek } : {}),
      hasSettlement: job.hasSettlement,
      ...(job.negotiationCount != null ? { negotiationCount: job.negotiationCount } : {}),
      ...(job.requiredSkills ? { requiredSkills: job.requiredSkills } : {}),
    } satisfies RawJob;

    const fit = computeFit(raw, ev, hard, hard.targetMonthlyJpy);
    const pass = computePass(raw, ev);
    const total = Math.round((fit.pct * pass.pct) / 100);

    // 落とさずに採点している媒体（担当者提案）の「引っかかった点」を付け直す
    const filter = noHardDrop(raw) ? hardFilter(raw, hard) : { pass: true as const };
    const filterNote = filter.pass ? null : filter.reason;

    // ％が同じでも内訳の作りが変わることがある（加点を bonus に分けた等）。
    // 画面は内訳を読むので、内訳の差も更新の対象にする
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (
      fit.pct === job.fitPct &&
      pass.pct === job.passPct &&
      total === job.totalPct &&
      filterNote === job.filterNote &&
      same(fit.breakdown, job.fitBreakdown) &&
      same(pass.breakdown, job.passBreakdown)
    ) {
      continue;
    }
    if (filterNote !== job.filterNote) {
      console.log(
        `  条件判定: ${job.filterNote ?? "なし"} → ${filterNote ?? "なし"}  ${job.title.slice(0, 30)}`,
      );
    }
    changed++;
    console.log(
      `${String(job.totalPct).padStart(3)}% → ${String(total).padStart(3)}%  ` +
        `適合 ${String(job.fitPct).padStart(3)}→${String(fit.pct).padStart(3)} ` +
        `通過 ${String(job.passPct).padStart(3)}→${String(pass.pct).padStart(3)}  ` +
        job.title.slice(0, 38),
    );

    if (!dry) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          fitPct: fit.pct,
          passPct: pass.pct,
          totalPct: total,
          fitBreakdown: fit.breakdown,
          passBreakdown: pass.breakdown,
          filterNote,
        },
      });
    }
  }

  console.log(`\n変わったもの ${changed}件${dry ? "（--dry なので書いていない）" : " を更新した"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
