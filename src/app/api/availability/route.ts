/**
 * 商談を受けられる条件（不可日を含む）の読み書き。
 *
 * 不可日を画面から登録できるようにするための口。
 * 「ここは❌」を自分で入れて、それ以外を機械が答える形にする。
 *
 * 書き込み先は availability.json だけ。個人の予定なのでコミットしない
 * （.gitignore 済み）。
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { loadAvailability } from "@/lib/apply/availability";
import { proposeSlots } from "@/lib/apply/availability";
import { calendarSources } from "@/lib/calendar/ics";
import { formatDayWindow } from "@/lib/calendar/slots";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "availability.json");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(): Promise<NextResponse> {
  try {
    const cfg = loadAvailability();
    const slots = await proposeSlots({ max: 3 });
    return NextResponse.json({
      config: cfg,
      calendars: calendarSources().map((c) => c.name),
      slots: slots.days.map((d) => ({ label: formatDayWindow(d), start: d.date })),
      busyCount: slots.busyCount,
      refusedReason: slots.refusedReason,
      warnings: slots.warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as {
    unavailableDates?: string[];
    allowWithoutCalendar?: boolean;
  };

  if (body.unavailableDates && body.unavailableDates.some((d) => !DATE.test(d))) {
    return NextResponse.json({ error: "日付は YYYY-MM-DD の形で渡す" }, { status: 400 });
  }

  try {
    const current = loadAvailability();
    const next = {
      ...current,
      ...(body.unavailableDates
        ? { unavailableDates: [...new Set(body.unavailableDates)].sort() }
        : {}),
      ...(body.allowWithoutCalendar !== undefined
        ? { allowWithoutCalendar: body.allowWithoutCalendar }
        : {}),
    };
    fs.writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
    return NextResponse.json({ config: next });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
