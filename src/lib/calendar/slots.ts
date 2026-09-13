/**
 * 商談の希望日程を出す。
 *
 * カレンダーで埋まっている時間帯と、自分の稼働条件（曜日・時間帯・不可日）から
 * 空いている枠を計算する。
 *
 * 原則: **予定が読めていないときに「空いている」と言わない。**
 * カレンダーの取得に失敗したら枠を出さず、失敗として上に返す（ics.ts の errors）。
 * 間違って埋まっている時間を提案すると、相手の時間を奪って信用を落とすので、
 * 「分からないときは黙る」を選ぶ。
 */

import type { BusyInterval } from "./ics";
import { jstDate } from "./ics";

export type Availability = {
  /** 商談を受ける曜日。0=日 1=月 … 6=土 */
  weekdays: number[];
  /** 開始できる最も早い時刻（JST・時） */
  fromHour: number;
  /** 終了していなければならない時刻（JST・時） */
  toHour: number;
  /** 商談1件の長さ（分） */
  durationMinutes: number;
  /** 予定の前後に空けておく余白（分） */
  bufferMinutes: number;
  /** 終日その日を避ける日付（YYYY-MM-DD）。旅行や既に決まっている休み */
  unavailableDates: string[];
  /** 今日から何日後以降を提案するか。当日・翌日を避けるため */
  leadDays: number;
};

export const DEFAULT_AVAILABILITY: Availability = {
  weekdays: [1, 2, 3, 4, 5],
  fromHour: 10,
  toHour: 18,
  durationMinutes: 60,
  bufferMinutes: 30,
  unavailableDates: [],
  leadDays: 2,
};

export type Slot = { start: Date; end: Date };

const MIN = 60 * 1000;
const JST_OFFSET_MS = 9 * 3600 * 1000;

/** JST での曜日（0=日）。UTC の Date から求める */
function jstWeekday(d: Date): number {
  return new Date(d.getTime() + JST_OFFSET_MS).getUTCDay();
}

/** JST のその日の指定時刻を UTC の Date で返す */
function jstTime(dateStr: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:${mm}:00+09:00`);
}

/** 埋まっている時間帯を、余白を付けて正規化してまとめる */
export function mergeBusy(busy: BusyInterval[], bufferMinutes: number): Slot[] {
  const padded = busy
    .map((b) => ({
      // 終日の予定はその日を丸ごと埋まり扱いにする
      start: b.allDay
        ? jstTime(jstDate(b.start), 0)
        : new Date(b.start.getTime() - bufferMinutes * MIN),
      end: b.allDay
        ? new Date(jstTime(jstDate(b.start), 0).getTime() + 24 * 60 * MIN)
        : new Date(b.end.getTime() + bufferMinutes * MIN),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Slot[] = [];
  for (const p of padded) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.end) {
      if (p.end > last.end) last.end = p.end;
    } else {
      merged.push({ start: new Date(p.start), end: new Date(p.end) });
    }
  }
  return merged;
}

/**
 * 空いている枠を出す。
 * 1日につき最大2枠までにして、候補が特定の日に偏らないようにする。
 */
export function freeSlots(
  busy: BusyInterval[],
  availability: Availability,
  opts: { now?: Date; days?: number; max?: number; perDay?: number } = {},
): Slot[] {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 21;
  const max = opts.max ?? 5;
  const perDay = opts.perDay ?? 2;

  const blocked = mergeBusy(busy, availability.bufferMinutes);
  const unavailable = new Set(availability.unavailableDates);
  const out: Slot[] = [];

  for (let offset = availability.leadDays; offset <= days && out.length < max; offset++) {
    const dayDate = new Date(now.getTime() + offset * 24 * 60 * MIN);
    const dateStr = jstDate(dayDate);
    if (unavailable.has(dateStr)) continue;

    const dayStart = jstTime(dateStr, availability.fromHour);
    if (!availability.weekdays.includes(jstWeekday(dayStart))) continue;

    const dayEnd = jstTime(dateStr, availability.toHour);
    let found = 0;

    // 30分刻みで空きを探す
    for (
      let t = dayStart.getTime();
      t + availability.durationMinutes * MIN <= dayEnd.getTime() && found < perDay;
      t += 30 * MIN
    ) {
      const start = new Date(t);
      const end = new Date(t + availability.durationMinutes * MIN);
      const overlaps = blocked.some((b) => start < b.end && end > b.start);
      if (overlaps) continue;
      out.push({ start, end });
      found++;
      if (out.length >= max) break;
      // 同じ日の次の候補は間を空ける
      t += (availability.durationMinutes + availability.bufferMinutes) * MIN;
    }
  }
  return out;
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];

/** 応募文に書く形（記入例に合わせる）。 */
export function formatSlot(slot: Slot): string {
  const j = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS);
  const s = j(slot.start);
  const e = j(slot.end);
  const hhmm = (d: Date) =>
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return (
    `${s.getUTCFullYear()}年 ${s.getUTCMonth() + 1}月 ${s.getUTCDate()}日（${WD[s.getUTCDay()]}）` +
    `${hhmm(s)}開始~${hhmm(e)}終了の間`
  );
}

// ---------------------------------------------------------------------------
// 日ごとの「空いている時間帯」
//
// 1時間の枠を3つ並べる書き方（10:00開始~11:00終了の間 を3行）は、
// 相手に選ばせる幅が狭いうえに行数を食う。
// 「その日のこの時間帯以外なら空いている」と書いたほうが、
// 同じ字数で相手の選べる幅が広くなる。
// ---------------------------------------------------------------------------

export type DayWindow = {
  /** JST の日付（YYYY-MM-DD） */
  date: string;
  /** その日に商談を受けられる範囲（例 10:00〜18:00） */
  window: Slot;
  /** 実際に空いている時間帯（商談1件の長さに足りないものは含めない） */
  free: Slot[];
  /** 範囲のうち空いていない時間帯。free の裏返しなので必ず整合する */
  busy: Slot[];
};

/** 範囲から除いた残り（差集合）。区間は開始順に並んでいる前提 */
function subtract(window: Slot, blocked: Slot[]): Slot[] {
  const out: Slot[] = [];
  let cursor = window.start.getTime();
  const end = window.end.getTime();

  for (const b of blocked) {
    const bs = Math.max(b.start.getTime(), cursor);
    const be = Math.min(b.end.getTime(), end);
    if (be <= cursor) continue;
    if (bs > cursor) out.push({ start: new Date(cursor), end: new Date(bs) });
    cursor = Math.max(cursor, be);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ start: new Date(cursor), end: new Date(end) });
  return out;
}

/**
 * 日ごとの空き時間帯を出す。
 *
 * busy は free の裏返しとして計算する（埋まっている予定をそのまま書かない）。
 * こうしないと「1時間に足りないので候補から外した時間」が
 * 「空いている」ことになってしまい、文面が事実と食い違う。
 */
export function freeWindows(
  busy: BusyInterval[],
  availability: Availability,
  opts: { now?: Date; days?: number; maxDays?: number } = {},
): DayWindow[] {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 21;
  const maxDays = opts.maxDays ?? 3;

  const blocked = mergeBusy(busy, availability.bufferMinutes);
  const unavailable = new Set(availability.unavailableDates);
  const out: DayWindow[] = [];

  for (let offset = availability.leadDays; offset <= days && out.length < maxDays; offset++) {
    const dateStr = jstDate(new Date(now.getTime() + offset * 24 * 60 * MIN));
    if (unavailable.has(dateStr)) continue;

    const window = {
      start: jstTime(dateStr, availability.fromHour),
      end: jstTime(dateStr, availability.toHour),
    };
    if (!availability.weekdays.includes(jstWeekday(window.start))) continue;

    const free = subtract(window, blocked).filter(
      (s) => s.end.getTime() - s.start.getTime() >= availability.durationMinutes * MIN,
    );
    if (free.length === 0) continue;

    out.push({ date: dateStr, window, free, busy: subtract(window, free) });
  }
  return out;
}

const hhmm = (d: Date): string => {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
};

const range = (s: Slot): string => `${hhmm(s.start)}〜${hhmm(s.end)}`;

/**
 * 応募文に書く1日ぶんの文。
 *
 *   9月15日（火）10:00〜18:00
 *   9月15日（火）10:00〜18:00（12:00〜13:00 以外）
 *   9月15日（火）10:00〜12:00、14:00〜18:00
 *
 * 除く時間帯が多いときは、空いている時間帯を並べる形に切り替える
 * （「以外」が3つ以上並ぶと読みにくく、取り違えのもとになる）。
 */
export function formatDayWindow(day: DayWindow): string {
  const d = new Date(day.window.start.getTime() + JST_OFFSET_MS);
  const head = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WD[d.getUTCDay()]}）`;

  if (day.busy.length === 0) return `${head}${range(day.window)}`;
  if (day.busy.length <= 2) {
    return `${head}${range(day.window)}（${day.busy.map(range).join("、")} 以外）`;
  }
  return `${head}${day.free.map(range).join("、")}`;
}
