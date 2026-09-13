/**
 * カレンダーと日程候補のテスト。ネットワークは使わない。
 *
 * ここで守りたいのは「埋まっている時間を提案しない」こと。
 * 間違って提案すると相手の時間を奪って信用を落とすので、境界を固定する。
 */

import { describe, expect, it } from "vitest";

import { jstDate, parseIcs, type BusyInterval } from "@/lib/calendar/ics";
import {
  DEFAULT_AVAILABILITY,
  formatDayWindow,
  formatSlot,
  freeSlots,
  freeWindows,
  mergeBusy,
  type Availability,
} from "@/lib/calendar/slots";

const ics = (body: string) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`;

const FROM = new Date("2026-09-13T00:00:00+09:00");
const TO = new Date("2026-10-13T00:00:00+09:00");

describe("ICS の読み取り", () => {
  it("時刻ありの予定を読む", () => {
    const events = parseIcs(
      ics(
        `BEGIN:VEVENT\nUID:a\nDTSTART;TZID=Asia/Tokyo:20260914T100000\nDTEND;TZID=Asia/Tokyo:20260914T110000\nSUMMARY:面談\nEND:VEVENT`,
      ),
      "個人",
      FROM,
      TO,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe("面談");
    expect(events[0]?.allDay).toBe(false);
    expect(jstDate(events[0]!.start)).toBe("2026-09-14");
  });

  it("繰り返し予定を期間内に展開する", () => {
    const events = parseIcs(
      ics(
        `BEGIN:VEVENT\nUID:b\nDTSTART;TZID=Asia/Tokyo:20260914T100000\nDTEND;TZID=Asia/Tokyo:20260914T110000\nSUMMARY:定例\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3\nEND:VEVENT`,
      ),
      "仕事",
      FROM,
      TO,
    );
    expect(events).toHaveLength(3);
  });

  it("終日の予定は allDay になる", () => {
    const events = parseIcs(
      ics(
        `BEGIN:VEVENT\nUID:c\nDTSTART;VALUE=DATE:20260916\nDTEND;VALUE=DATE:20260917\nSUMMARY:旅行\nEND:VEVENT`,
      ),
      "個人",
      FROM,
      TO,
    );
    expect(events[0]?.allDay).toBe(true);
  });

  it("キャンセル済みと空き扱いの予定は埋まりにしない", () => {
    const body = [
      `BEGIN:VEVENT\nUID:d\nDTSTART;TZID=Asia/Tokyo:20260914T100000\nDTEND;TZID=Asia/Tokyo:20260914T110000\nSTATUS:CANCELLED\nSUMMARY:中止\nEND:VEVENT`,
      `BEGIN:VEVENT\nUID:e\nDTSTART;TZID=Asia/Tokyo:20260914T140000\nDTEND;TZID=Asia/Tokyo:20260914T150000\nTRANSP:TRANSPARENT\nSUMMARY:空き扱い\nEND:VEVENT`,
    ].join("\n");
    expect(parseIcs(ics(body), "個人", FROM, TO)).toHaveLength(0);
  });

  it("期間外の予定は返さない", () => {
    const events = parseIcs(
      ics(
        `BEGIN:VEVENT\nUID:f\nDTSTART;TZID=Asia/Tokyo:20250101T100000\nDTEND;TZID=Asia/Tokyo:20250101T110000\nSUMMARY:去年\nEND:VEVENT`,
      ),
      "個人",
      FROM,
      TO,
    );
    expect(events).toHaveLength(0);
  });
});

describe("埋まっている時間のまとめ", () => {
  const ev = (s: string, e: string, allDay = false): BusyInterval => ({
    start: new Date(s),
    end: new Date(e),
    allDay,
    calendar: "個人",
    summary: "x",
  });

  it("前後に余白を付ける", () => {
    const [m] = mergeBusy([ev("2026-09-14T10:00:00+09:00", "2026-09-14T11:00:00+09:00")], 30);
    expect(m?.start.toISOString()).toBe(new Date("2026-09-14T09:30:00+09:00").toISOString());
    expect(m?.end.toISOString()).toBe(new Date("2026-09-14T11:30:00+09:00").toISOString());
  });

  it("重なる予定をまとめる", () => {
    const merged = mergeBusy(
      [
        ev("2026-09-14T10:00:00+09:00", "2026-09-14T11:00:00+09:00"),
        ev("2026-09-14T11:15:00+09:00", "2026-09-14T12:00:00+09:00"),
      ],
      30,
    );
    expect(merged).toHaveLength(1);
  });

  it("複数アカウントの予定を混ぜてまとめられる", () => {
    const a = ev("2026-09-14T10:00:00+09:00", "2026-09-14T11:00:00+09:00");
    const b = { ...ev("2026-09-14T10:30:00+09:00", "2026-09-14T12:00:00+09:00"), calendar: "仕事" };
    expect(mergeBusy([a, b], 0)).toHaveLength(1);
  });

  it("終日の予定はその日を丸ごと埋める", () => {
    const [m] = mergeBusy([ev("2026-09-16T00:00:00+09:00", "2026-09-17T00:00:00+09:00", true)], 30);
    expect(m?.start.toISOString()).toBe(new Date("2026-09-16T00:00:00+09:00").toISOString());
    expect(m?.end.toISOString()).toBe(new Date("2026-09-17T00:00:00+09:00").toISOString());
  });
});

describe("日程候補", () => {
  // 2026-09-13 は日曜
  const NOW = new Date("2026-09-13T09:00:00+09:00");
  const base = { ...DEFAULT_AVAILABILITY };

  const ev = (s: string, e: string, allDay = false): BusyInterval => ({
    start: new Date(s),
    end: new Date(e),
    allDay,
    calendar: "個人",
    summary: "x",
  });

  it("予定が無ければ営業時間の先頭から出る", () => {
    const slots = freeSlots([], base, { now: NOW, max: 1 });
    expect(slots).toHaveLength(1);
    // leadDays=2 → 9/15（火）の 10:00
    expect(slots[0]?.start.toISOString()).toBe(
      new Date("2026-09-15T10:00:00+09:00").toISOString(),
    );
  });

  it("埋まっている時間を提案しない", () => {
    const busy = [ev("2026-09-15T10:00:00+09:00", "2026-09-15T17:30:00+09:00")];
    const slots = freeSlots(busy, base, { now: NOW, max: 3 });
    for (const s of slots) {
      expect(s.start.toISOString()).not.toBe(
        new Date("2026-09-15T10:00:00+09:00").toISOString(),
      );
    }
  });

  it("不可日を避ける", () => {
    const slots = freeSlots([], { ...base, unavailableDates: ["2026-09-15"] }, {
      now: NOW,
      max: 1,
    });
    expect(jstDate(slots[0]!.start)).not.toBe("2026-09-15");
  });

  it("土日を避ける", () => {
    const slots = freeSlots([], base, { now: NOW, max: 10 });
    for (const s of slots) {
      const wd = new Date(s.start.getTime() + 9 * 3600 * 1000).getUTCDay();
      expect(wd).toBeGreaterThanOrEqual(1);
      expect(wd).toBeLessThanOrEqual(5);
    }
  });

  it("終日の予定がある日は丸ごと避ける", () => {
    const busy = [ev("2026-09-15T00:00:00+09:00", "2026-09-16T00:00:00+09:00", true)];
    const slots = freeSlots(busy, base, { now: NOW, max: 5 });
    for (const s of slots) expect(jstDate(s.start)).not.toBe("2026-09-15");
  });

  it("1日に偏らせない", () => {
    const slots = freeSlots([], base, { now: NOW, max: 5, perDay: 2 });
    const byDay = new Map<string, number>();
    for (const s of slots) byDay.set(jstDate(s.start), (byDay.get(jstDate(s.start)) ?? 0) + 1);
    for (const n of byDay.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("営業時間を超える枠は出さない", () => {
    const slots = freeSlots([], { ...base, toHour: 18 }, { now: NOW, max: 10 });
    for (const s of slots) {
      const endJst = new Date(s.end.getTime() + 9 * 3600 * 1000);
      expect(endJst.getUTCHours()).toBeLessThanOrEqual(18);
    }
  });

  it("応募文の形式は記入例に合わせる", () => {
    const slot = {
      start: new Date("2026-09-15T11:00:00+09:00"),
      end: new Date("2026-09-15T12:00:00+09:00"),
    };
    expect(formatSlot(slot)).toBe("2026年 9月 15日（火）11:00開始~12:00終了の間");
  });
});

describe("freeWindows / formatDayWindow", () => {
  const availability: Availability = {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    fromHour: 10,
    toHour: 18,
    durationMinutes: 60,
    bufferMinutes: 0,
    unavailableDates: [],
    leadDays: 0,
  };
  // 2026-09-15（火）を基準にする
  const now = new Date("2026-09-15T00:00:00+09:00");

  const busy = (date: string, from: string, to: string): BusyInterval => ({
    start: new Date(`${date}T${from}:00+09:00`),
    end: new Date(`${date}T${to}:00+09:00`),
    allDay: false,
    calendar: "テスト",
    summary: "予定",
  });

  it("予定が無い日は範囲をそのまま書く", () => {
    const days = freeWindows([], availability, { now, days: 0, maxDays: 1 });
    expect(formatDayWindow(days[0]!)).toBe("9月15日（火）10:00〜18:00");
  });

  it("予定がある日は「以外」で書く", () => {
    const days = freeWindows([busy("2026-09-15", "12", "13")], availability, {
      now,
      days: 0,
      maxDays: 1,
    });
    expect(formatDayWindow(days[0]!)).toBe("9月15日（火）10:00〜18:00（12:00〜13:00 以外）");
  });

  it("除く時間帯が3つ以上なら、空いている時間帯を並べる", () => {
    const days = freeWindows(
      [
        busy("2026-09-15", "11", "12"),
        busy("2026-09-15", "13", "14"),
        busy("2026-09-15", "16", "17"),
      ],
      availability,
      { now, days: 0, maxDays: 1 },
    );
    // 10-11 / 12-13 は1時間ちょうどなので候補に残る
    expect(formatDayWindow(days[0]!)).toBe(
      "9月15日（火）10:00〜11:00、12:00〜13:00、14:00〜16:00、17:00〜18:00",
    );
  });

  it("1時間に足りない時間は「空いている」に入れない", () => {
    // 10:30 から埋まると 10:00〜10:30 しか残らない
    const days = freeWindows([busy("2026-09-15", "10:30", "18")], availability, {
      now,
      days: 0,
      maxDays: 1,
    });
    expect(days).toHaveLength(0);
  });

  it("除いた時間帯は空いている時間帯の裏返しになる（文面と事実が食い違わない）", () => {
    // 10:00〜10:30 は1時間に足りないので候補から外れる。
    // その30分を「空いている」と書いてしまわないことを確かめる
    const days = freeWindows([busy("2026-09-15", "10:30", "12")], availability, {
      now,
      days: 0,
      maxDays: 1,
    });
    const text = formatDayWindow(days[0]!);
    expect(text).toBe("9月15日（火）10:00〜18:00（10:00〜12:00 以外）");
    expect(days[0]!.free).toHaveLength(1);
  });

  it("不可日は出さない", () => {
    const days = freeWindows([], { ...availability, unavailableDates: ["2026-09-15"] }, {
      now,
      days: 0,
      maxDays: 1,
    });
    expect(days).toHaveLength(0);
  });
});
