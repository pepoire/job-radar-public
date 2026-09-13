/**
 * 商談を受けられる条件の読み込み。
 *
 * 予定の出どころは2つ。
 *   1. Googleカレンダー（iCal の非公開URL）… 自動で埋まっている時間を除く
 *   2. availability.json の unavailableDates … 本人が「ここは無理」と決めた日
 *
 * カレンダーを設定しているのに読めなかったときは、日程を提案しない。
 * 予定が読めていないのに空いていると答えるのが一番危ない
 * （相手の時間を取って信用を落とす）ので、分からないときは黙る。
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { fetchBusy, type BusyInterval } from "@/lib/calendar/ics";
import {
  DEFAULT_AVAILABILITY,
  freeWindows,
  type Availability,
  type DayWindow,
} from "@/lib/calendar/slots";
import { calendarSources } from "@/lib/calendar/ics";

const availabilitySchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).default(DEFAULT_AVAILABILITY.weekdays),
  fromHour: z.number().int().min(0).max(23).default(DEFAULT_AVAILABILITY.fromHour),
  toHour: z.number().int().min(1).max(24).default(DEFAULT_AVAILABILITY.toHour),
  durationMinutes: z.number().int().positive().default(DEFAULT_AVAILABILITY.durationMinutes),
  bufferMinutes: z.number().int().min(0).default(DEFAULT_AVAILABILITY.bufferMinutes),
  leadDays: z.number().int().min(0).default(DEFAULT_AVAILABILITY.leadDays),
  unavailableDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  /** カレンダー未接続でも日程候補を出すか */
  allowWithoutCalendar: z.boolean().default(false),
});

export type AvailabilityConfig = z.infer<typeof availabilitySchema>;

const FILE = "availability.json";

export function loadAvailability(root = process.cwd()): AvailabilityConfig {
  for (const name of [FILE, FILE.replace(".json", ".example.json")]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    const stripped = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !k.startsWith("_")),
    );
    const parsed = availabilitySchema.safeParse(stripped);
    if (!parsed.success) {
      throw new Error(
        `${name} が不正: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`,
      );
    }
    return parsed.data;
  }
  return availabilitySchema.parse({});
}

export type SlotResult = {
  days: DayWindow[];
  /** 参照したカレンダーの数 */
  calendars: number;
  /** 埋まっていた時間帯の数 */
  busyCount: number;
  /** 日程を出さなかった理由。null なら出せている */
  refusedReason: string | null;
  /** 参考情報として出す警告（提案は止めない） */
  warnings: string[];
};

/**
 * 日程候補を出す。出せないときは refusedReason を埋めて slots を空にする。
 * 「候補が無い」と「予定が読めていない」を混ぜないための戻り値の形。
 */
export async function proposeSlots(
  opts: { now?: Date; days?: number; max?: number } = {},
): Promise<SlotResult> {
  const cfg = loadAvailability();
  const availability: Availability = {
    weekdays: cfg.weekdays,
    fromHour: cfg.fromHour,
    toHour: cfg.toHour,
    durationMinutes: cfg.durationMinutes,
    bufferMinutes: cfg.bufferMinutes,
    unavailableDates: cfg.unavailableDates,
    leadDays: cfg.leadDays,
  };

  const now = opts.now ?? new Date();
  const days = opts.days ?? 21;
  const from = new Date(now.getTime() + cfg.leadDays * 24 * 3600 * 1000);
  const to = new Date(now.getTime() + days * 24 * 3600 * 1000);

  const configured = calendarSources().length;
  let busy: BusyInterval[] = [];
  const warnings: string[] = [];

  if (configured === 0) {
    if (!cfg.allowWithoutCalendar) {
      return {
        days: [],
        calendars: 0,
        busyCount: 0,
        refusedReason:
          "Googleカレンダーが未接続です。予定が読めないまま日程を出すと、" +
          "埋まっている時間を提案してしまいます。" +
          "下の「参照するGoogleカレンダー」から iCal形式の非公開URL を登録するか、" +
          "不可日を自分で入れて「カレンダーを繋がず、不可日だけで日程を出す」に印を付けてください。",
        warnings,
      };
    }
    warnings.push(
      "カレンダー未接続のまま日程を出している（availability.json の不可日だけで判断している）",
    );
  } else {
    const res = await fetchBusy(from, to);
    if (res.errors.length > 0) {
      return {
        days: [],
        calendars: configured,
        busyCount: 0,
        refusedReason: `カレンダーを読めなかった: ${res.errors.join(" / ")}`,
        warnings,
      };
    }
    busy = res.busy;
  }

  const found = freeWindows(busy, availability, {
    now,
    days,
    ...(opts.max ? { maxDays: opts.max } : {}),
  });

  return {
    days: found,
    calendars: configured,
    busyCount: busy.length,
    refusedReason:
      found.length === 0
        ? `${cfg.leadDays}日後〜${days}日後に空いている時間帯が無い（不可日 ${cfg.unavailableDates.length}件 / 予定 ${busy.length}件）`
        : null,
    warnings,
  };
}
