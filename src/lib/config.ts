/**
 * 希望条件と経歴の読み込み。
 *
 * 数字のハードフィルタは criteria.json、ニュアンスは criteria.md、
 * 経歴は career.md。この3つだけがチューニング対象。
 * 3つとも個人情報を含むので .gitignore してあり、公開リポジトリには
 * *.example.* を置く。
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { PromptInputError } from "./llm/errors";

const ROOT = process.cwd();

/**
 * 毎日回す検索条件。中身は provider ごとに違うので、ここでは形だけ決める。
 * どう解釈するかは provider の実装に任せる（このリポジトリには入っていない）。
 */
export const searchSchema = z.object({
  name: z.string().min(1),
  /** provider に渡す検索条件。URLのパス、クエリ、APIのパラメータなど */
  query: z.string().min(1),
  pages: z.number().int().min(1).max(10).default(1),
});

export type SearchCondition = z.infer<typeof searchSchema>;

export const hardCriteriaSchema = z.object({
  /** 毎日回す検索条件。provider が解釈する。無くても動く */
  searches: z.array(searchSchema).default([]),
  /** 目標単価。希望適合度が満点になるライン（scoring.ts） */
  targetMonthlyJpy: z.number().int().positive(),
  minMonthlyJpy: z.number().int().positive(),
  /** 週4日以下の案件はこちらの下限を使う（時間単価で見れば高いため） */
  minMonthlyJpyIfShortWeek: z.number().int().positive().optional(),
  shortWeekDays: z.number().int().positive().optional(),
  dropIfMonthlyUnknown: z.boolean().default(false),
  dropIfOnsite: z.boolean().default(true),
  dropIfPartialRemote: z.boolean().default(false),
  /** 職種の語。タイトルと募集職種だけを照合する */
  ngTitleKeywords: z.array(z.string()).default([]),
  /** 技術・ドメインの語。必須スキル欄まで照合する */
  ngSkillKeywords: z.array(z.string()).default([]),
  maxDaysPerWeek: z.number().int().positive().nullable().default(null),
  /** Slack に出す総合マッチ度の下限（％）。総合＝希望適合度×通過可能性 */
  notifyTotalMin: z.number().int().min(0).max(100).default(40),
  maxLlmCallsPerRun: z.number().int().positive().default(25),
});

export type HardCriteria = z.infer<typeof hardCriteriaSchema>;

const readFileOrExample = (name: string): string => {
  for (const candidate of [name, name.replace(/(\.[a-z]+)$/, ".example$1")]) {
    const p = path.join(ROOT, candidate);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new PromptInputError(`${name} が見つからない（${name} か *.example 版を置く）`);
};

export type Criteria = {
  hard: HardCriteria;
  /** LLM に読ませる希望条件の文章 */
  soft: string;
  /** LLM に読ませる経歴 */
  career: string;
};

export function loadCriteria(): Criteria {
  const rawJson = readFileOrExample("criteria.json");
  // "_comment" や "_note" で始まるキーは説明用なので落とす
  const stripped = Object.fromEntries(
    Object.entries(JSON.parse(rawJson) as Record<string, unknown>).filter(
      ([k]) => !k.startsWith("_"),
    ),
  );
  const hard = hardCriteriaSchema.safeParse(stripped);
  if (!hard.success) {
    throw new PromptInputError(
      `criteria.json が不正: ${hard.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`,
    );
  }

  const soft = readFileOrExample("criteria.md");
  const career = readFileOrExample("career.md");
  if (!soft.trim()) throw new PromptInputError("criteria.md が空。希望条件が無いと評価できない");
  if (!career.trim()) throw new PromptInputError("career.md が空。経歴が無いと照合できない");

  return { hard: hard.data, soft, career };
}
