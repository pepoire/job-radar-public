/**
 * 採点の構造化出力スキーマ。
 *
 * 設計の約束: **LLM にパーセンテージを言わせない。**
 * LLM が出すのは「数えられること」と「案件票に書かれているかどうか」だけ。
 * 重み付けと％の計算は lib/scoring.ts に置く。
 * そうすることで「なぜこの数字になったか」を人に説明できる。
 *
 * 自由文で返させると「良さそうです」という要約になって並べ替えられないので、
 * zod を単一の正とし、API に渡す JSON Schema はそこから生成する
 * （型と実行時検証とプロンプト仕様が食い違わないようにするため）。
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const remoteReadingSchema = z.enum(["FULL", "PARTIAL", "ONSITE", "UNCLEAR"]);

export const evaluationSchema = z.object({
  verdict: z
    .string()
    .max(120)
    .describe("1文の結論。「〜なので合う/合わない」の形。前置きを書かない。"),

  // --- 通過可能性の材料（数えられること） ---
  requirementsTotal: z
    .number()
    .int()
    .min(0)
    .describe("案件票の必須要件（求めるスキル）の項目数。列挙されていなければ0。"),
  requirementsMet: z
    .number()
    .int()
    .min(0)
    .describe("そのうち経歴で満たしているものの数。満たしていないものを数に入れない。"),
  requirementsMissing: z
    .array(z.string().max(80))
    .max(5)
    .describe("満たしていない必須要件。案件票の表現をそのまま短く写す。"),
  domainExperience: z
    .enum(["HAVE", "PARTIAL", "NONE"])
    .describe("案件の業界・ドメインの経験。HAVE=経験あり PARTIAL=近い業界 NONE=未経験"),
  domainRequired: z
    .boolean()
    .describe(
      "案件票が業界・ドメインの知識や経験を必須または歓迎として挙げているか。" +
        "「製造業での経験」「財務会計の業務知識」「医療画像解析の研究開発経験」のように " +
        "スキル要件として書かれている場合だけ true。" +
        "単に業界欄が「金融」となっているだけ、案件名に業界が入っているだけでは false。",
    ),

  // --- 希望適合度の材料（条件に反しているか） ---
  absoluteBlockers: z
    .array(z.enum(["REMOTE", "CONTRACT", "ROLE", "NONE"]))
    .describe(
      "絶対条件に反している点。REMOTE=フルリモートでない CONTRACT=正社員前提や正社員化の示唆 " +
        "ROLE=開発が主業務でない（PM専任・PMO等）。反していなければ [\"NONE\"]",
    ),
  aiCore: z
    .enum(["CORE", "PERIPHERAL", "NONE"])
    .describe(
      "AIの位置づけ。CORE=プロダクトの中核がAI PERIPHERAL=AI活用歓迎レベル NONE=AI要素なし",
    ),
  pmValue: z
    .enum(["CAREER_BUILDING", "NEUTRAL", "NOT_USEFUL", "NONE"])
    .describe(
      "PM要素の価値。CAREER_BUILDING=職務経歴書にPM実績として書ける " +
        "NOT_USEFUL=PM補佐やPMOメンバーで実績にならない NONE=PM要素なし",
    ),

  // --- 案件票の読み取り ---
  remoteReading: remoteReadingSchema.describe(
    "案件票の文面から読めるリモート度。フラグではなく本文を根拠にする。",
  ),
  monthlyReading: z
    .number()
    .int()
    .nullable()
    .describe("月額（円）。案件票に書かれていなければ null。推定しない。"),
  stackOverlap: z
    .array(z.string().max(40))
    .max(8)
    .describe("経歴と案件要件で実際に重なっている技術名だけ。重なっていないものを入れない。"),

  // --- 人が読む部分 ---
  reasons: z
    .array(z.string().max(160))
    .max(3)
    .describe("評価の根拠。案件票に書かれている事実だけを引く。推測を書かない。"),
  concerns: z
    .array(z.string().max(160))
    .max(3)
    .describe("懸念。無ければ空配列。経歴に無い必須要件・条件の曖昧さを優先して挙げる。"),
});

export type Evaluation = z.infer<typeof evaluationSchema>;

/**
 * まとめて採点するときの形。
 *
 * 1案件ずつ呼ばない理由: Claude Code CLI 経由だと1回の呼び出しごとに
 * CLI 自身のシステムプロンプト（実測28,419トークン）が固定費でかかる。
 * 25件を個別に呼ぶと固定費だけで70万トークンを超えるので、
 * 経歴と希望条件を1回だけ送って全件まとめて採点させる。
 */
export const batchEvaluationSchema = z.object({
  evaluations: z
    .array(evaluationSchema.extend({ uid: z.string() }))
    .describe("入力で渡された案件それぞれの評価。uid は入力の案件IDをそのまま返す。"),
});

export type BatchEvaluation = z.infer<typeof batchEvaluationSchema>;

/**
 * zod から生成した JSON Schema のメタキーを落とす。
 * zod-to-json-schema は $schema に draft 2019-09 の URL を付けるが、
 * Claude Code CLI の --json-schema はそれを解決できず弾く（実測）。
 */
function stripMeta(schema: object): object {
  const { $schema: _drop, definitions: _defs, ...rest } = schema as Record<string, unknown>;
  return rest;
}

/** API に渡す JSON Schema。zod から生成する（型と検証と仕様を食い違わせない）。 */
export const evaluationJsonSchema = stripMeta(
  zodToJsonSchema(evaluationSchema, { $refStrategy: "none" }),
);

export const batchEvaluationJsonSchema = stripMeta(
  zodToJsonSchema(batchEvaluationSchema, { $refStrategy: "none" }),
);
