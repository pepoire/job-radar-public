/**
 * Googleカレンダーの「iCal形式の非公開URL」から予定を取る。
 *
 * なぜ Google Calendar API を使わないか
 *   OAuth の同意画面を通すには Google Cloud の管理画面が必要で、
 *   そこに2段階認証の壁があり、さらにテスト状態ではトークンが7日で失効する。
 *   非公開ICSのURLなら認証もコンソールも要らず、失効もしない。
 *   複数アカウントもURLを並べるだけで対応できる。
 *
 * URLの取り方（アカウントごとに1回）
 *   calendar.google.com → カレンダー名の「⋮」→ 設定と共有
 *   → 一番下「カレンダーの統合」→「iCal形式の非公開URL」
 *
 * URLの置き場所は2つ。どちらも実質的な認証情報（知っていれば予定を読める）なので
 * コミットしない。
 *   1. 画面の「商談を出せる日」から登録する → state/calendars.json（.gitignore 済み）
 *   2. 環境変数（無人実行など、画面を使わない場合）
 *        JOBRADAR_CALENDAR_ICS=<url1>,<url2>,...
 *        JOBRADAR_CALENDAR_NAMES=個人,仕事   （任意。表示名。URLと同じ順で並べる）
 *
 * 予定の中身（件名や参加者）は取り込まない。**埋まっている時間帯だけ**を使う。
 * 商談日程の提案に必要なのは「空いているか」だけで、
 * 何の予定かは案件の応募先に関係がないため。
 */

import fs from "node:fs";
import path from "node:path";

import ical from "node-ical";

/** 埋まっている時間帯。件名は画面で自分が見るためだけに持つ。 */
export type BusyInterval = {
  start: Date;
  end: Date;
  /** 終日の予定か。終日はその日を丸ごと埋まり扱いにする */
  allDay: boolean;
  /** どのカレンダーか（複数アカウントを区別する） */
  calendar: string;
  /** 自分が画面で見るためだけの件名。応募文には一切出さない */
  summary: string;
};

export type CalendarSource = { url: string; name: string };

/** 画面から登録したカレンダーの置き場所 */
export const CALENDARS_FILE = path.join(process.cwd(), "state", "calendars.json");

/** 画面から登録したぶん。読めなければ空にする（環境変数ぶんは残す） */
function fromFile(): CalendarSource[] {
  try {
    if (!fs.existsSync(CALENDARS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(CALENDARS_FILE, "utf8")) as {
      calendars?: { url?: string; name?: string }[];
    };
    return (raw.calendars ?? [])
      .filter((c): c is { url: string; name?: string } => Boolean(c.url))
      .map((c, i) => ({ url: c.url, name: c.name?.trim() || `カレンダー${i + 1}` }));
  } catch {
    return [];
  }
}

/** 環境変数ぶん。無人実行のときはこちらを使う */
function fromEnv(): CalendarSource[] {
  const urls = (process.env.JOBRADAR_CALENDAR_ICS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const names = (process.env.JOBRADAR_CALENDAR_NAMES ?? "")
    .split(",")
    .map((s) => s.trim());
  return urls.map((url, i) => ({ url, name: names[i] || `カレンダー${i + 1}` }));
}

/**
 * 参照するカレンダーの一覧。画面から登録したぶんと環境変数ぶんを合わせる。
 * 同じURLは1つにまとめる（両方に書いてしまっても二重に数えない）。
 */
export function calendarSources(): CalendarSource[] {
  const out: CalendarSource[] = [];
  const seen = new Set<string>();
  for (const c of [...fromFile(), ...fromEnv()]) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/** 画面に出す用。URLは実質的な認証情報なので伏せる */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${u.host}/…${tail.slice(-8)}`;
  } catch {
    return "（URLの形ではない）";
  }
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** JST の日付文字列（YYYY-MM-DD） */
export function jstDate(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST のその日の 00:00 と 24:00 を UTC の Date で返す */
export function jstDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

/**
 * 1つのICSを取って、期間内の予定を埋まっている時間帯に変換する。
 * 繰り返し予定（RRULE）は期間内に展開する。
 */
export function parseIcs(
  text: string,
  calendar: string,
  from: Date,
  to: Date,
): BusyInterval[] {
  const data = ical.sync.parseICS(text);
  const out: BusyInterval[] = [];

  for (const key of Object.keys(data)) {
    const ev = data[key] as {
      type?: string;
      start?: Date;
      end?: Date;
      summary?: string;
      datetype?: string;
      status?: string;
      transparency?: string;
      rrule?: { between: (a: Date, b: Date, inc?: boolean) => Date[] };
    };
    if (ev.type !== "VEVENT" || !ev.start) continue;

    // 辞退済み・空き時間として扱う予定は埋まり扱いにしない
    if (ev.status === "CANCELLED") continue;
    if (ev.transparency === "TRANSPARENT") continue;

    const allDay = ev.datetype === "date";
    const durationMs =
      ev.end && ev.end > ev.start ? ev.end.getTime() - ev.start.getTime() : 60 * 60 * 1000;
    const summary = ev.summary ?? "(件名なし)";

    if (ev.rrule) {
      // 繰り返しは期間内に展開する。境界の予定も拾うため前後に余裕を持たせる
      const starts = ev.rrule.between(
        new Date(from.getTime() - durationMs),
        new Date(to.getTime() + durationMs),
        true,
      );
      for (const s of starts) {
        out.push({
          start: s,
          end: new Date(s.getTime() + durationMs),
          allDay,
          calendar,
          summary,
        });
      }
      continue;
    }

    out.push({
      start: ev.start,
      end: new Date(ev.start.getTime() + durationMs),
      allDay,
      calendar,
      summary,
    });
  }

  // 期間に重なるものだけ残す
  return out.filter((b) => b.end > from && b.start < to);
}

export type FetchBusyResult = {
  busy: BusyInterval[];
  /** 取れなかったカレンダー。静かに「予定なし」にしないため必ず返す */
  errors: string[];
  /** 設定されているカレンダー数 */
  sources: number;
};

/**
 * 全カレンダーから期間内の予定を取る。
 *
 * **1つでも取得に失敗したら errors に残す。**
 * 予定が読めていないのに「空いている」と提案するのが一番危ないので、
 * 呼び出し側でエラーがあれば提案を止められるようにしておく。
 */
export async function fetchBusy(from: Date, to: Date): Promise<FetchBusyResult> {
  const sources = calendarSources();
  const busy: BusyInterval[] = [];
  const errors: string[] = [];

  for (const src of sources) {
    try {
      const res = await fetch(src.url, { redirect: "follow" });
      if (!res.ok) {
        errors.push(`${src.name}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) {
        errors.push(`${src.name}: ICS ではない応答（URLを確認）`);
        continue;
      }
      busy.push(...parseIcs(text, src.name, from, to));
    } catch (e) {
      errors.push(`${src.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  busy.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { busy, errors, sources: sources.length };
}
