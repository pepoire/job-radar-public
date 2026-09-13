/**
 * 商談希望の短文（200字以内）を組み立てる。
 *
 * 送信フォームは自由記述の1枠しかなく、記入例がこうなっている:
 *   【商談の希望日程】2026年 4月 21日 11:00開始~12:00終了の間
 *   【要求スキルのマッチ】TypeScript 経験 ○ / Claude Code 経験 ×
 *
 * 方針
 *   - **○× は盛らない。** 満たしていないものは × のまま出す。
 *     ここで嘘を書くと商談で崩れて、担当者からの信用も失う。
 *   - 200字に収まらないときは「日程の候補数」を減らす。要求スキルの行は削らない。
 *     担当者が見ているのはスキルの一致なので、そこを欠けさせない。
 *   - 日程はカレンダーの空きから作る（calendar/slots.ts）。
 *     カレンダーが読めていないときは下書きを作らない（呼び出し側で止める）。
 */

import { formatDayWindow, type DayWindow } from "@/lib/calendar/slots";

export const MAX_CHARS = 200;

export type SkillMark = {
  /** 案件票の必須要件を短くしたもの */
  label: string;
  /** 満たしているか。LLM が数えた「不足している必須要件」との照合で決める */
  met: boolean;
};

/**
 * 必須要件の1行を、送る文に載せる短いラベルにする。
 *
 * 記入例が「TypeScript 経験 ○」の形なので、技術名 + 経験に寄せる。
 * 途中で「…」で切ると人が書いた文に見えないので、切るときは
 * 助詞などの区切りで切って言い切る。
 */
const TECH = /[A-Za-z][A-Za-z0-9.+#/-]*(?: (?:on|for) [A-Za-z][A-Za-z0-9.+#/-]*)*/g;
/** 技術名として扱わない一般語 */
const NOT_TECH = new Set(["web", "os", "it", "ai", "ui", "ux", "api", "db"]);
/**
 * 日本語だけの行を切るときの区切り。長い順に効くよう、
 * 「またはそれに準ずる」のような節の頭も入れてある。
 * 助詞1文字だけにすると「4名以上の開発チームにおけるテックリード経験」が
 * 「4名以上」になって意味が落ちる（実測）。
 */
const BREAKS = [
  "または",
  "もしくは",
  "および",
  "及び",
  "における",
  "において",
  "としての",
  "として",
  "を用いた",
  "を使用した",
  "、",
  "と",
  "や",
  "に",
  "で",
  "を",
  "の",
];

export function shortLabel(line: string, max = 22): string {
  const base = line
    .replace(/^[・\-–—•*\s]+/, "")
    .replace(/[（(【].*$/, "")
    .replace(/[、,].*$/, "")
    .trim();
  if (!base) return "";

  // 技術名が入っていれば「技術名 経験」にする。最大2つまで並べる
  const techs = [...base.matchAll(TECH)]
    .map((m) => m[0].trim())
    .filter((t) => t.length >= 2 && !NOT_TECH.has(t.toLowerCase()));
  const picked = [...new Set(techs)].slice(0, 2);
  if (picked.length > 0) {
    const label = `${picked.join("/")} 経験`;
    if (label.length <= max + 6) return label;
  }

  if (base.length <= max) return base;

  // 区切りで切る。切れる場所が無ければそのまま返す（嘘にはならない）
  let cut = -1;
  for (const b of BREAKS) {
    const i = base.lastIndexOf(b, max);
    if (i > cut && i >= 4) cut = i;
  }
  return cut > 0 ? base.slice(0, cut) : base;
}

/** 突き合わせに使う正規化。表記の揺れを落とす */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[\s・,、。.()（）【】〜~\-–—:：]/g, "");

/** 文字2-gram の集合 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 2つの文がどれだけ同じことを言っているか（0〜1）。
 *
 * 部分文字列の一致では足りない。LLM が返す「不足している要件」は
 * 案件票の言い回しの要約になっていて、
 * 「それに準ずる」→「準ずる」、「複数名の開発チーム」→「複数名開発チーム」
 * のように言い換えが入るため、連続一致では取れない（実測）。
 * 2-gram の重なり（Dice係数）で見る。
 */
export function similarity(a: string, b: string): number {
  const x = bigrams(norm(a));
  const y = bigrams(norm(b));
  if (x.size === 0 || y.size === 0) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return (2 * hit) / (x.size + y.size);
}

/** これを下回る一致しか無ければ「突き合わせできなかった」とする */
const MATCH_FLOOR = 0.25;

/**
 * 必須要件の原文を項目ごとに割る。
 *
 * 1行1項目ではない。案件票は長い項目を
 *   ・テックリードまたはそれに準ずる役割としての下記作業経験
 *   　- 複数名の開発チームにおける技術選定
 *   　- アーキテクチャ設計
 * のように折り返して書く。行で割ると1項目が4つに分かれ、
 * 分かれた断片のうち1つだけが × になって残りが ○ になる
 * （＝満たしていない経験を「あり」と書いてしまう）。
 * 行頭が箇条書き記号の行だけを新しい項目の始まりとして扱う。
 */
export function splitRequirements(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const items: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^【/.test(line)) continue;
    const isNew = /^[・●◆○*]/.test(raw.trimStart()) && !/^[\s　]/.test(raw);
    if (isNew || items.length === 0) items.push(line);
    else items[items.length - 1] += ` ${line}`;
  }
  return items.filter((i) => i.replace(/^[・●◆○*\s]+/, "").length > 1);
}

export type MarkResult = {
  marks: SkillMark[];
  /** どの項目とも突き合わせられなかった不足要件。あれば下書きを作らない */
  unmatched: string[];
};

/**
 * 必須要件の原文と「不足している要件」から ○× を作る。
 *
 * LLM に ○× を直接出させない。LLM が出すのは不足しているものの列挙だけで、
 * どの項目が × なのかの突き合わせはここでやる。
 *
 * 不足要件1件につき項目1件を × にする（1対1に割り当てる）。
 * 項目ごとに閾値で判定すると、言い換えで閾値を下回った不足要件が
 * まるごと ○ に化ける。**満たしていないものを ○ にしないこと**が
 * この関数のいちばん大事な性質なので、割り当てに失敗したら
 * unmatched に残して呼び出し側で止める。
 */
export function skillMarks(
  requiredSkills: string | null | undefined,
  requirementsMissing: readonly string[],
  limit = 5,
): MarkResult {
  const items = splitRequirements(requiredSkills);
  if (items.length === 0) return { marks: [], unmatched: [...requirementsMissing] };

  const missingIndex = new Set<number>();
  const unmatched: string[] = [];

  for (const m of requirementsMissing) {
    let best = -1;
    let bestScore = 0;
    items.forEach((item, i) => {
      if (missingIndex.has(i)) return;
      const score = similarity(item, m);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= MATCH_FLOOR) missingIndex.add(best);
    else unmatched.push(m);
  }

  const marks = items.slice(0, limit).map((item, i) => ({
    label: shortLabel(item),
    met: !missingIndex.has(i),
  }));

  // limit で切り落とした項目に × が含まれていたら、× を優先して残す
  if (items.length > limit) {
    const cutMissing = [...missingIndex].filter((i) => i >= limit);
    for (const i of cutMissing) {
      const replace = marks.findIndex((m) => m.met);
      if (replace >= 0) marks[replace] = { label: shortLabel(items[i]!), met: false };
    }
  }

  return { marks, unmatched };
}

export type Draft = {
  text: string;
  /** 入れられなかった日付の数。UI で「あと何日ぶんあるか」を出す */
  daysOmitted: number;
  /** 入れられなかった要求スキルの数。0 でなければ UI で警告する */
  marksOmitted: number;
};

/**
 * 下書きを作る。200字を**超えない**ことを保証する。
 *
 * 日程は「その日のこの時間帯以外」の形で書く。1時間の枠を並べるより
 * 同じ字数で相手の選べる幅が広くなる。
 *
 * 日付が1日も無い、または要求スキルが1行も入らない場合は null を返す
 * （中身の足りない文章を送らせない）。
 */
export function buildDraft(
  days: readonly DayWindow[],
  marks: readonly SkillMark[],
  max = MAX_CHARS,
): Draft | null {
  if (days.length === 0) return null;

  const render = (nDays: number, nMarks: number): string => {
    const parts: string[] = ["【商談の希望日程】"];
    for (const d of days.slice(0, nDays)) parts.push(formatDayWindow(d));
    if (nMarks > 0) {
      parts.push("【要求スキルのマッチ】");
      for (const m of marks.slice(0, nMarks)) parts.push(`${m.label} ${m.met ? "○" : "×"}`);
    }
    return parts.join("\n");
  };

  // 日付1日 + 要求スキル全件から始める。入らなければスキルを後ろから削る
  let nMarks = marks.length;
  while (nMarks > 0 && render(1, nMarks).length > max) nMarks--;
  if (marks.length > 0 && nMarks === 0) return null;
  if (render(1, nMarks).length > max) return null;

  // 余裕があれば日付を増やす
  let nDays = 1;
  while (nDays < days.length && render(nDays + 1, nMarks).length <= max) nDays++;

  return {
    text: render(nDays, nMarks),
    daysOmitted: days.length - nDays,
    marksOmitted: marks.length - nMarks,
  };
}
