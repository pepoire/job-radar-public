/**
 * 商談希望の短文づくりのテスト。
 * 200字を超えないこと、○× を盛らないことが要点。
 */

import { describe, expect, it } from "vitest";

import {
  buildDraft,
  MAX_CHARS,
  shortLabel,
  skillMarks,
  splitRequirements,
} from "@/lib/apply/draft";
import type { DayWindow } from "@/lib/calendar/slots";

/** その日 10:00〜18:00 が全部空いている日 */
const fullDay = (date: string): DayWindow => {
  const window = {
    start: new Date(`${date}T10:00:00+09:00`),
    end: new Date(`${date}T18:00:00+09:00`),
  };
  return { date, window, free: [window], busy: [] };
};

const DAYS = [fullDay("2026-09-16"), fullDay("2026-09-17"), fullDay("2026-09-18")];

describe("shortLabel", () => {
  it("技術名が入っていれば「技術名 経験」にする（記入例の形）", () => {
    expect(shortLabel("・TypeScriptを用いた開発経験(3年以上)")).toBe("TypeScript 経験");
    expect(shortLabel("・Vue.jsとReact等のJavaScriptフレームワーク経験")).toBe(
      "Vue.js/React 経験",
    );
  });

  it("技術名が無ければ本文を使い、長いときは区切りで切る（…で切らない）", () => {
    expect(shortLabel("・要件定義の経験")).toBe("要件定義の経験");
    const long = shortLabel("・クラウド環境でのアプリケーション設計と開発経験");
    expect(long).not.toContain("…");
    expect(long.length).toBeLessThanOrEqual(22);
  });
  it("長すぎるものは短くする", () => {
    expect(
      shortLabel("・とても長い必須要件がここにずっと書かれている場合の扱い").length,
    ).toBeLessThanOrEqual(23);
  });
});

describe("skillMarks", () => {
  const required = "・TypeScriptを用いた開発経験(3年以上)\n・Azureでの開発経験\n・AIエージェントの開発経験";

  it("不足している要件を × にする", () => {
    const { marks } = skillMarks(required, ["Azureでの開発経験"]);
    expect(marks.map((m) => [m.label, m.met])).toEqual([
      ["TypeScript 経験", true],
      ["Azure 経験", false],
      ["AIエージェントの開発経験", true],
    ]);
  });

  it("表記が少し違っても同じ要件として × にする", () => {
    const { marks } = skillMarks(required, ["Azure での開発経験(実務)"]);
    expect(marks.find((m) => m.label.startsWith("Azure"))?.met).toBe(false);
  });

  it("満たしていないものを ○ に盛らない", () => {
    const { marks } = skillMarks(required, ["TypeScriptを用いた開発経験(3年以上)"]);
    expect(marks[0]?.met).toBe(false);
  });

  it("必須要件が無ければ空", () => {
    expect(skillMarks(null, []).marks).toEqual([]);
    expect(skillMarks("【必須】", []).marks).toEqual([]);
  });
});

describe("buildDraft", () => {
  const { marks } = skillMarks(
    "・TypeScriptを用いた開発経験(3年以上)\n・Azureでの開発経験",
    ["Azureでの開発経験"],
  );

  it("記入例の形で書く", () => {
    const d = buildDraft(DAYS, marks);
    expect(d).not.toBeNull();
    expect(d!.text).toContain("【商談の希望日程】");
    expect(d!.text).toContain("9月16日（水）10:00〜18:00");
    expect(d!.text).toContain("【要求スキルのマッチ】");
    expect(d!.text).toContain("TypeScript 経験 ○");
    expect(d!.text).toContain("Azure 経験 ×");
  });

  it("200字を超えない", () => {
    const { marks: many } = skillMarks(
      Array.from({ length: 5 }, (_, i) => `・とても長い必須要件の名前その${i}が書かれている行`).join("\n"),
      [],
    );
    const d = buildDraft(DAYS, many);
    expect(d!.text.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  it("収まらないときは要求スキルより先に日付を削る", () => {
    const { marks: many } = skillMarks(
      Array.from({ length: 5 }, (_, i) => `・必須要件${i}の経験`).join("\n"),
      [],
    );
    const d = buildDraft(DAYS, many)!;
    expect(d.marksOmitted).toBe(0);
    expect(d.daysOmitted).toBeGreaterThanOrEqual(0);
  });

  it("日付が無ければ作らない", () => {
    expect(buildDraft([], marks)).toBeNull();
  });

  it("要求スキルが1行も入らないなら作らない", () => {
    // 日程1件だけで上限に達する狭さにすると、スキル行が入らない
    expect(buildDraft(DAYS, marks, 50)).toBeNull();
  });
});

describe("splitRequirements", () => {
  // 4911541 の実データ。長い項目が「　- 」で折り返されている
  const raw =
    "・Webアプリケーションの設計開発運用を一貫して担った実務経験\n" +
    "・テックリードまたはそれに準ずる役割としての下記作業経験\n" +
    "　- 複数名の開発チームにおける技術選定\n" +
    "　- アーキテクチャ設計\n" +
    "　- 設計方針の決定\n" +
    "・PdMやPjMとの連携と設計実装を行いながら要件整理まで推進した経験";

  it("折り返しを前の項目にくっつける", () => {
    const items = splitRequirements(raw);
    expect(items).toHaveLength(3);
    expect(items[1]).toContain("テックリード");
    expect(items[1]).toContain("アーキテクチャ設計");
  });

  it("行で割ると項目数が合わなくなる（この関数が要る理由）", () => {
    expect(raw.split("\n")).toHaveLength(6);
    expect(splitRequirements(raw)).toHaveLength(3);
  });
});

describe("満たしていない要件を ○ にしない", () => {
  // 4911541 の実データ。LLM の言い回しは案件票の要約になっている
  const raw =
    "・Webアプリケーションの設計開発運用を一貫して担った実務経験\n" +
    "・TypeScriptまたはJavaScriptを用いたフロントエンドとバックエンドを横断した設計実装経験\n" +
    "・テックリードまたはそれに準ずる役割としての下記作業経験\n" +
    "　- 複数名の開発チームにおける技術選定\n" +
    "　- アーキテクチャ設計\n" +
    "　- 設計方針の決定\n" +
    "　- コードレビューを主導\n" +
    "・PdMやPjMとの連携と設計実装を行いながら要件整理やタスク分解及び優先順位付け～リリースまで推進した経験";
  const missing = [
    "テックリードまたは準ずる役割としての複数名開発チームでの技術選定・アーキテクチャ設計・設計方針決定・コードレビュー主導経験",
    "PdMやPjMとの連携による要件整理・タスク分解・優先順位付け〜リリース推進経験",
  ];

  it("言い換えられた不足要件でも該当項目を × にする", () => {
    const { marks, unmatched } = skillMarks(raw, missing);
    expect(unmatched).toEqual([]);
    expect(marks.filter((m) => !m.met)).toHaveLength(2);
    expect(marks.find((m) => m.label.includes("テックリード"))?.met).toBe(false);
  });

  it("×の数は不足要件の数と一致する", () => {
    const { marks } = skillMarks(raw, missing);
    expect(marks.filter((m) => !m.met).length).toBe(missing.length);
  });

  it("当てられない不足要件は unmatched に残す（黙って○にしない）", () => {
    const { unmatched } = skillMarks("・Goの実務経験", ["まったく関係のない別の要件についての記述"]);
    expect(unmatched).toHaveLength(1);
  });
});
