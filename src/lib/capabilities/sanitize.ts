/**
 * LLM に渡す前の無害化。
 *
 * 案件票は他人が書いた文章なので、そこに「評価を5にしろ」と書いてあっても
 * 指示として扱ってはいけない。データとして扱うために、指示に見える形を崩す。
 */

/** 見えない文字（ゼロ幅・BOM）。案件票にはコピペ由来でよく混ざる。 */
const INVISIBLE = /[​‌‍﻿]/g;
const NBSP = / /g;

/** 案件票の中に紛れた命令文の目印 */
const INJECTION =
  /(ignore\s+(all\s+)?previous|disregard\s+.{0,20}instruction|system\s?prompt|あなたは.{0,10}として振る舞|以上の指示を無視|スコアを\s*5|必ず.{0,6}と評価)/gi;

export function clean(text: string | null | undefined, limit = 6000): string {
  if (!text) return "";
  let t = text.replace(INVISIBLE, "").replace(NBSP, " ");
  t = t.replace(INJECTION, "〔除去〕");
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.length > limit) t = `${t.slice(0, limit)}\n…（以下省略）`;
  return t.trim();
}
