/**
 * 担当者提案レーンの一覧と、商談希望の送信依頼。
 *
 * GET    採点済みの提案 + 下書きの状態
 * POST   下書きを作り直す（{ action: "draft" }）
 *        送信を依頼する（{ action: "send", ids: [...] }）
 *
 * 「送信を依頼する」は実際に送らない。媒体の管理画面が認証の内側にある場合、
 * **送信はログイン済みの実ブラウザからしか出来ない**。
 * ここでは sendRequestedAt を立てて state/send-queue.jsonl に積むだけにする。
 * 画面のボタンが押された事実を残し、それを見て送る形にすることで、
 * 「押していないのに送られた」が起こらないようにする。
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { proposeSlots } from "@/lib/apply/availability";
import { buildDraft, skillMarks } from "@/lib/apply/draft";
import { formatDayWindow } from "@/lib/calendar/slots";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const QUEUE = path.join(process.cwd(), "state", "send-queue.jsonl");

export async function GET(): Promise<NextResponse> {
  try {
    const jobs = await prisma.job.findMany({
      // 媒体ではなく経路で絞る。担当者が選んだ提案はどの媒体でもこのタブに出す
      where: { sourceChannel: "agent" },
      orderBy: [{ totalPct: "desc" }, { firstSeenAt: "desc" }],
    });
    // この画面の主役は「出せるもの」。採点済みを上に、除外・未採点を下に置く。
    // Prisma の enum の並びは宣言順（FETCHED→DROPPED→SCORED→FAILED）なので
    // stage でソートすると除外が先頭に来てしまう
    const rank = (stage: string) => (stage === "SCORED" ? 0 : stage === "FAILED" ? 1 : 2);
    jobs.sort((a, b) => rank(a.stage) - rank(b.stage));
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ error: String(e), jobs: [] }, { status: 500 });
  }
}

/** 下書きを作り直す。日程は全件同じ候補にする（同じ日に複数入れないため） */
async function regenerate(): Promise<NextResponse> {
  const slotResult = await proposeSlots({ max: 3 });
  if (slotResult.refusedReason) {
    return NextResponse.json(
      { error: slotResult.refusedReason, refused: true },
      { status: 409 },
    );
  }

  const jobs = await prisma.job.findMany({
    where: { sourceChannel: "agent", stage: "SCORED", sentAt: null },
  });

  const lines = slotResult.days.map((d) => formatDayWindow(d));
  let made = 0;
  const failed: string[] = [];

  for (const job of jobs) {
    const missing = Array.isArray(job.requirementsMissing)
      ? (job.requirementsMissing as string[])
      : [];
    const { marks, unmatched } = skillMarks(job.requiredSkills, missing);
    if (unmatched.length > 0) {
      // 満たしていない要件に ○ を付けてしまうのを防ぐため、ここで止める
      failed.push(`${job.title.slice(0, 26)}（不足要件を案件票に当てられない）`);
      continue;
    }
    const draft = buildDraft(slotResult.days, marks);
    if (!draft) {
      failed.push(`${job.title.slice(0, 26)}（200字に収まらない）`);
      continue;
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { draftText: draft.text, draftDays: lines },
    });
    made++;
  }

  return NextResponse.json({
    made,
    failed,
    days: slotResult.days.length,
    warnings: slotResult.warnings,
  });
}

/** 送信を依頼する。実際の送信は実ブラウザで行う */
async function requestSend(ids: string[]): Promise<NextResponse> {
  const jobs = await prisma.job.findMany({ where: { id: { in: ids } } });

  const missingDraft = jobs.filter((j) => !j.draftText);
  if (missingDraft.length > 0) {
    return NextResponse.json(
      {
        error: `下書きの無い提案が ${missingDraft.length}件ある。先に下書きを作る`,
        titles: missingDraft.map((j) => j.title.slice(0, 30)),
      },
      { status: 400 },
    );
  }
  const alreadySent = jobs.filter((j) => j.sentAt);
  if (alreadySent.length > 0) {
    return NextResponse.json(
      {
        error: `送信済みの提案が ${alreadySent.length}件含まれている`,
        titles: alreadySent.map((j) => j.title.slice(0, 30)),
      },
      { status: 409 },
    );
  }

  const at = new Date();
  await prisma.job.updateMany({
    where: { id: { in: jobs.map((j) => j.id) } },
    data: { sendRequestedAt: at, sendError: null },
  });

  // 送る側（実ブラウザ）が見る待ち行列。1行1件にして追記だけにする
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  for (const job of jobs) {
    fs.appendFileSync(
      QUEUE,
      `${JSON.stringify({
        requestedAt: at.toISOString(),
        id: job.id,
        uid: job.uid,
        url: job.url,
        title: job.title,
        totalPct: job.totalPct,
        draftText: job.draftText,
      })}\n`,
    );
  }

  return NextResponse.json({ requested: jobs.length, requestedAt: at.toISOString() });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { action?: string; ids?: string[] };
  try {
    if (body.action === "draft") return await regenerate();
    if (body.action === "send") {
      if (!body.ids?.length) {
        return NextResponse.json({ error: "ids が空" }, { status: 400 });
      }
      return await requestSend(body.ids);
    }
    return NextResponse.json({ error: `不明な action: ${body.action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
