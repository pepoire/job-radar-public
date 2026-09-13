/**
 * 案件 -> ブリーフ。
 *
 * 生の案件票をそのまま LLM に投げない。まず毎回同じ形のブリーフに正規化する。
 * 理由は2つ。
 *
 *   1. サイトごとに文面の作りが違うので、そのまま渡すと評価軸がぶれる。
 *      プラットフォームのレコメンドが的外れになる原因はだいたいこれ。
 *   2. 「書かれていないこと」を明示できる。単価が不明なとき、欄を消すのではなく
 *      「単価: 記載なし」と書いて渡す。そうしないとモデルが勝手に推定する。
 */

import type { RawJob } from "@/lib/providers/types";
import { monthlyEquivalent, STANDARD_HOURS_PER_MONTH } from "@/lib/providers/types";

import { clean } from "./sanitize";

const REMOTE_LABEL: Record<string, string> = {
  FULL: "フルリモート",
  PARTIAL: "一部リモート（出社あり）",
  ONSITE: "常駐",
};

export const yen = (n: number | null | undefined): string =>
  n == null ? "記載なし" : `月額 ${n.toLocaleString("ja-JP")} 円（${Math.round(n / 10000)}万円）`;

function rateLine(job: RawJob): string {
  if (job.monthlyJpy != null) return yen(job.monthlyJpy);
  if (job.hourlyJpy != null) {
    const { value } = monthlyEquivalent(job);
    return (
      `時間単価 ${job.hourlyJpy.toLocaleString("ja-JP")} 円` +
      `（案件票に月額の記載は無い。月${STANDARD_HOURS_PER_MONTH}時間で換算すると約` +
      `${Math.round((value ?? 0) / 10000)}万円だが、これは換算値であって案件票の記載ではない）`
    );
  }
  return "記載なし";
}

/** RawJob -> LLM に渡す1案件のブリーフ文字列。 */
export function buildJobBrief(job: RawJob): string {
  return [
    "## 案件",
    `媒体: ${job.source}`,
    `タイトル: ${clean(job.title, 200)}`,
    `掲載日: ${job.postedOn ?? "記載なし"}`,
    `単価: ${rateLine(job)}`,
    `リモート（取得側の一次判定）: ${
      job.remote ? (REMOTE_LABEL[job.remote] ?? "記載から判断できない") : "記載から判断できない"
    }`,
    `最低稼働日数: ${job.minDaysPerWeek ? `週${job.minDaysPerWeek}日` : "記載なし"}`,
    `職種・ポジション: ${clean(job.roleText, 300) || "記載なし"}`,
    "",
    "### 求めるスキル",
    clean(job.requiredSkills, 1200) || "記載なし",
    "",
    "### 歓迎スキル",
    clean(job.welcomeSkills, 800) || "記載なし",
    "",
    "### 案件票の本文",
    clean(job.body, 4000) || "記載なし",
  ].join("\n");
}

/** 経歴と希望条件のブリーフ。毎回同じ形で渡す。 */
export function buildPersonBrief(career: string, criteria: string): string {
  return [
    "## 私の経歴",
    clean(career, 5000) || "（未設定）",
    "",
    "## 私の希望条件",
    clean(criteria, 4000) || "（未設定）",
  ].join("\n");
}
