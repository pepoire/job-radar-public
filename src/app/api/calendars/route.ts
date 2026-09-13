/**
 * 参照するGoogleカレンダー（iCal の非公開URL）の登録。
 *
 * URLの取り方（アカウントごとに1回）
 *   calendar.google.com → カレンダー名の「⋮」→ 設定と共有
 *   → 一番下「カレンダーの統合」→「iCal形式の非公開URL」
 *
 * 登録時に必ず1回取得して、本当に読めるURLかを確かめる。
 * 読めないURLを黙って登録すると、「予定なし」と「取得できていない」の
 * 区別がつかなくなって、埋まっている時間を提案しかねない。
 *
 * URLは知っていれば予定が読める実質的な認証情報なので、
 * 画面には伏せた形でしか返さない。保存先は state/calendars.json（.gitignore 済み）。
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { CALENDARS_FILE, calendarSources, maskUrl } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";

type Stored = { calendars: { name: string; url: string }[] };

const read = (): Stored => {
  try {
    if (!fs.existsSync(CALENDARS_FILE)) return { calendars: [] };
    return JSON.parse(fs.readFileSync(CALENDARS_FILE, "utf8")) as Stored;
  } catch {
    return { calendars: [] };
  }
};

const write = (data: Stored): void => {
  fs.mkdirSync(path.dirname(CALENDARS_FILE), { recursive: true });
  // 実質的な認証情報なので本人だけが読める権限にする
  fs.writeFileSync(CALENDARS_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
};

/** 本当に読めるカレンダーかを確かめる */
async function verify(url: string): Promise<{ ok: true; events: number } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    return { ok: false, error: `取得できなかった: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}（URLを確認）` };
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    return {
      ok: false,
      error: "カレンダーの中身が返ってこない。「iCal形式の非公開URL」をそのまま貼る",
    };
  }
  return { ok: true, events: (text.match(/BEGIN:VEVENT/g) ?? []).length };
}

export function GET(): NextResponse {
  const stored = read().calendars.map((c) => c.url);
  return NextResponse.json({
    calendars: calendarSources().map((c) => ({
      name: c.name,
      masked: maskUrl(c.url),
      // 環境変数で入れたものは画面から消せない（どこを直すかを示す）
      editable: stored.includes(c.url),
    })),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { name?: string; url?: string };
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "URL が空" }, { status: 400 });
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "http(s) で始まるURLを貼る" }, { status: 400 });
  }

  const data = read();
  if (data.calendars.some((c) => c.url === url)) {
    return NextResponse.json({ error: "同じURLが登録済み" }, { status: 409 });
  }

  const check = await verify(url);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const name = body.name?.trim() || `カレンダー${data.calendars.length + 1}`;
  data.calendars.push({ name, url });
  write(data);

  return NextResponse.json({ added: name, events: check.events });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { name?: string };
  if (!body.name) return NextResponse.json({ error: "name が無い" }, { status: 400 });
  const data = read();
  const next = data.calendars.filter((c) => c.name !== body.name);
  if (next.length === data.calendars.length) {
    return NextResponse.json(
      { error: `${body.name} は画面から登録したものではない（環境変数を直す）` },
      { status: 404 },
    );
  }
  write({ calendars: next });
  return NextResponse.json({ removed: body.name });
}
