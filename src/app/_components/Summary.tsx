"use client";

/**
 * 上部の集計バー。参考画像の「Patient analytics」の3本のバーと同じ作り。
 * ベタ塗りの上に白い角丸チップのアイコンを置き、ラベルと数字を並べる。
 *
 * 毎朝ここだけ見て「今日は何件見るべきか」「放置しているものがあるか」が分かるようにする。
 */

import { IconChip, type Tone } from "./ui";

type Tile = {
  label: string;
  value: number;
  note: string;
  tone: Tone;
  fill: string;
  on: string;
  mark: string;
};

export function Summary({ counts }: { counts: Record<string, number> }) {
  const tiles: Tile[] = [
    {
      label: "応募候補",
      value: counts["SCORED_HIGH"] ?? 0,
      note: "総合40%以上",
      tone: "teal",
      fill: "bg-teal",
      on: "text-teal-on",
      mark: "◎",
    },
    {
      label: "気になる",
      value: counts["INTERESTED"] ?? 0,
      note: "返事をする前",
      tone: "amber",
      fill: "bg-amber",
      on: "text-amber-on",
      mark: "♡",
    },
    {
      label: "応募した",
      value: counts["APPLIED"] ?? 0,
      note: "返事を待っている",
      tone: "coral",
      fill: "bg-coral",
      on: "text-coral-on",
      mark: "✈",
    },
    {
      label: "条件で除外",
      value: counts["DROPPED"] ?? 0,
      note: "理由つきで残る",
      tone: "neutral",
      fill: "bg-panel",
      on: "text-muted",
      mark: "―",
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`rounded-card flex items-center gap-3 p-3.5 transition hover:brightness-[1.02] ${t.fill} ${t.on}`}
        >
          <IconChip tone={t.tone}>{t.mark}</IconChip>
          <div className="min-w-0">
            <p className="text-xs font-bold">{t.label}</p>
            <p className="tnum text-[26px] font-bold leading-none">{t.value}</p>
          </div>
          <p className="ml-auto self-end text-[10px] font-medium opacity-80">{t.note}</p>
        </div>
      ))}
    </div>
  );
}
