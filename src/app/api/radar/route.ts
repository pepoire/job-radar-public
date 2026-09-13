/**
 * HTTP から実行する口。**毎朝の定期実行はここではない。**
 *
 * 定期実行は GitHub Actions（.github/workflows/daily.yml）が
 * `pnpm radar run` を直接叩く。こちらは、UI をどこかにデプロイしたときに
 * 外から手で走らせたい場合の入口として残してある。
 *
 * CRON_SECRET を設定すると Authorization: Bearer で認可する。
 * 未設定なら本番では 401 を返す（無認可で開けない）。
 */

import { NextResponse } from "next/server";

import { runRadar, type RadarMode } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // 未設定なら開発環境でだけ通す。本番で無認可に開けない。
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get("command") ?? "run";
  if (!["run", "preview", "doctor"].includes(raw)) {
    return NextResponse.json({ error: `不正な command: ${raw}` }, { status: 400 });
  }
  const mode = raw as RadarMode;
  const skipLlm = url.searchParams.get("no_llm") === "true";

  const logs: string[] = [];
  try {
    const result = await runRadar({ mode, skipLlm, log: (s) => logs.push(s) });
    return NextResponse.json(
      {
        date: result.date,
        mode,
        // 取得失敗は 200 で隠さず、必ず本文に出す
        hadFetchFailure: result.hadFetchFailure,
        fetch: Object.fromEntries(
          Object.entries(result.fetchResults).map(([k, v]) => [
            k,
            { status: v.status, checked: v.checked, new: v.jobs.length, error: v.error ?? null },
          ]),
        ),
        scored: result.scored.length,
        dropped: result.dropped.length,
        failures: result.failures.length,
        notified: result.notified,
        logs,
      },
      { status: result.hadFetchFailure ? 207 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ error: String(e), logs }, { status: 500 });
  }
}
