/**
 * 一覧UIが読むエンドポイント。
 * 通知しなかったもの（スコア3以下・ハードフィルタ落ち）もここから見られる。
 * criteria をチューニングするには「なぜ落ちたか」を見る必要があるため。
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** タブに出す件数。1リクエストで返してタブ切り替えのたびに数え直さない。 */
async function tabCounts() {
  const [byStage, high] = await Promise.all([
    prisma.job.groupBy({ by: ["stage"], _count: { _all: true } }),
    prisma.job.count({ where: { stage: "SCORED", totalPct: { gte: 40 } } }),
  ]);
  const counts: Record<string, number> = { SCORED_HIGH: high };
  for (const row of byStage) counts[row.stage] = row._count._all;
  const byAction = await prisma.job.groupBy({
    by: ["action"],
    _count: { _all: true },
    where: { action: { not: "UNTOUCHED" } },
  });
  for (const row of byAction) counts[row.action] = row._count._all;
  return counts;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ボードの母集団: 自分が動かしたもの全部 + まだ触っていない応募候補
  if (url.searchParams.get("view") === "board") {
    try {
      const jobs = await prisma.job.findMany({
        where: {
          OR: [
            { action: { not: "UNTOUCHED" } },
            { stage: "SCORED", totalPct: { gte: 40 } },
          ],
        },
        orderBy: [{ totalPct: "desc" }, { firstSeenAt: "asc" }],
        take: 400,
      });
      return NextResponse.json({ jobs });
    } catch (e) {
      return NextResponse.json({ error: String(e), jobs: [] }, { status: 500 });
    }
  }

  const stage = url.searchParams.get("stage") ?? "SCORED";
  const minTotal = Number(url.searchParams.get("minTotal") ?? "0");
  const action = url.searchParams.get("action");

  try {
    const [jobs, counts] = await Promise.all([
      prisma.job.findMany({
        where: {
          ...(stage === "ALL" ? {} : { stage: stage as never }),
          ...(minTotal > 0 ? { totalPct: { gte: minTotal } } : {}),
          ...(action ? { action: action as never } : {}),
        },
        orderBy: [{ totalPct: "desc" }, { firstSeenAt: "desc" }],
        take: 200,
      }),
      tabCounts(),
    ]);
    return NextResponse.json({ jobs, counts });
  } catch (e) {
    return NextResponse.json({ error: String(e), jobs: [] }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { id?: string; action?: string; note?: string };
  if (!body.id) return NextResponse.json({ error: "id が無い" }, { status: 400 });
  try {
    const job = await prisma.job.update({
      where: { id: body.id },
      data: {
        ...(body.action
          ? { action: body.action as never, movedAt: new Date() }
          : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
