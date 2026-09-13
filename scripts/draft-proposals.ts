/**
 * 担当者提案に対する商談希望の下書きを作る。
 *
 *   pnpm draft            採点済みの担当者提案ぶんの下書きを作って DB に入れる
 *   pnpm draft --dry      DB に書かず内容だけ出す
 *
 * 日程はカレンダーの空きから1回だけ計算して全件に同じ内容を入れる。
 * 案件ごとに違う日を出すと、同じ日に複数の商談を入れてしまう。
 * （同じ範囲を出して先に埋まった順に確定する運用にする）
 */

import { buildDraft, skillMarks } from "../src/lib/apply/draft";
import { proposeSlots } from "../src/lib/apply/availability";
import { formatDayWindow } from "../src/lib/calendar/slots";

import { loadEnv } from "./env";

loadEnv();

const dry = process.argv.includes("--dry");

async function main(): Promise<void> {
  const slotResult = await proposeSlots({ max: 3 });
  console.log(`カレンダー ${slotResult.calendars}件 / 予定 ${slotResult.busyCount}件`);
  for (const w of slotResult.warnings) console.log(`  注意: ${w}`);

  if (slotResult.refusedReason) {
    console.error(`\n日程候補を出せない: ${slotResult.refusedReason}`);
    process.exit(1);
  }
  console.log("空いている時間帯:");
  for (const d of slotResult.days) console.log(`  ${formatDayWindow(d)}`);

  const { prisma } = await import("../src/lib/db");
  const jobs = await prisma.job.findMany({
    where: { sourceChannel: "agent", stage: "SCORED", sentAt: null },
    orderBy: { totalPct: "desc" },
  });
  console.log(`\n対象 ${jobs.length}件\n`);

  let made = 0;
  const skipped: string[] = [];

  for (const job of jobs) {
    const missing = Array.isArray(job.requirementsMissing)
      ? (job.requirementsMissing as string[])
      : [];
    const { marks, unmatched } = skillMarks(job.requiredSkills, missing);
    if (unmatched.length > 0) {
      // どの必須要件が満たせていないのか確定できないまま ○ を並べると
      // 満たしていない経験を「あり」と書いてしまう
      skipped.push(
        `${job.uid} ${job.title.slice(0, 26)}（不足要件を案件票の項目に当てられない: ` +
          `${unmatched.map((u) => u.slice(0, 24)).join(" / ")}）`,
      );
      continue;
    }
    const draft = buildDraft(slotResult.days, marks);

    if (!draft) {
      skipped.push(`${job.uid} ${job.title.slice(0, 30)}（200字に収まらない / 材料が無い）`);
      continue;
    }

    console.log(
      `[${String(job.totalPct).padStart(3)}%] ${job.title.slice(0, 40)}  ` +
        `${draft.text.length}字 ${marks.filter((m) => m.met).length}/${marks.length}○` +
        `${draft.marksOmitted ? ` 省略${draft.marksOmitted}` : ""}`,
    );

    if (!dry) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          draftText: draft.text,
          // 送信内容と突き合わせるため、書いた文そのものを残す
          draftDays: slotResult.days.map((d) => formatDayWindow(d)),
        },
      });
    }
    made++;
  }

  console.log(`\n下書き ${made}件${dry ? "（--dry なので保存していない）" : " を保存した"}`);
  for (const s of skipped) console.log(`  作れなかった: ${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
