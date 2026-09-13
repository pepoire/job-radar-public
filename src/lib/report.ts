/**
 * Slack に出す1通を組み立てる。
 *
 * 方針
 *   - 新着ゼロのときも「ゼロ」と言う。黙らない。
 *   - 取得失敗（failed）は案件より上に出す。静かに0件になるのを防ぐための表示。
 *   - スコアが閾値以上のものだけ本文に出す。それ未満は件数だけ。
 *     読まなくなるのが一番怖い。
 *   - 単価とリモート度は必ず数字と原文表記で出す。「好条件です」で済ませない。
 */

import type { Dropped, Scored } from "@/lib/capabilities/evaluate";
import type { FetchResult, RawJob } from "@/lib/providers/types";
import { monthlyEquivalent, STANDARD_HOURS_PER_MONTH } from "@/lib/providers/types";

const STATUS_LABEL: Record<string, string> = {
  ok: "正常",
  no_data: "公開データなし",
  failed: "取得失敗（仕様変更の疑い）",
  not_configured: "未設定",
};

const REMOTE_LABEL: Record<string, string> = {
  FULL: "フルリモート",
  PARTIAL: "一部リモート（出社あり）",
  ONSITE: "常駐",
  UNCLEAR: "本文から判断できず",
};

const PM_LABEL: Record<string, string> = {
  CAREER_BUILDING: "PM実績として書ける",
  NEUTRAL: "PM要素あり（実績価値は中立）",
  NOT_USEFUL: "PM要素はあるが実績にならない",
  NONE: "",
};

/** スレッド再発見用の目印。 */
export const marker = (date: string): string => `[JOB-RADAR ${date}]`;

const man = (n: number): string => `${Math.round(n / 10000)}万円`;

/** 単価の表示。時間単価しか無い案件を月額のように見せない。 */
export function rateLabel(job: RawJob, monthlyReading?: number | null): string {
  const n = monthlyReading ?? job.monthlyJpy;
  if (n != null) return man(n);
  if (job.hourlyJpy != null) {
    const { value } = monthlyEquivalent(job);
    return `時間単価${job.hourlyJpy.toLocaleString("ja-JP")}円（月${STANDARD_HOURS_PER_MONTH}hで約${man(value ?? 0)}）`;
  }
  return "単価記載なし";
}

function runLink(): string | null {
  const url = process.env.JOBRADAR_DASHBOARD_URL;
  return url ? url : null;
}

export function buildText(args: {
  date: string;
  fetchResults: Record<string, FetchResult>;
  scored: Scored[];
  dropped: Dropped[];
  failures: { job: RawJob; error: string }[];
  notifyTotalMin: number;
}): string {
  const { date, fetchResults, scored, dropped, failures, notifyTotalMin } = args;
  const out: string[] = [];

  const link = runLink();
  out.push(`*案件レーダー ${date}*${link ? `  <${link}|一覧を開く>` : ""}`);
  out.push(marker(date));

  // --- 取得の健全性を先に出す ---
  const broken = Object.entries(fetchResults).filter(([, r]) => r.status === "failed");
  if (broken.length > 0) {
    out.push("");
    out.push(":rotating_light: *取得に失敗した媒体があります*");
    for (const [name, r] of broken) {
      out.push(`• \`${name}\` ${(r.error ?? "").slice(0, 300)}`);
    }
  }

  const lines = Object.entries(fetchResults).map(([name, r]) => {
    const label = STATUS_LABEL[r.status] ?? r.status;
    if (r.status !== "ok") return `\`${name}\` ${label}`;
    let extra = `確認${r.checked}件 / 新規${r.jobs.length}件`;
    if (r.bulkDropped) extra += ` / 自動配信を除外${r.bulkDropped}件`;
    return `\`${name}\` ${label}（${extra}）`;
  });
  out.push("");
  out.push(`取得: ${lines.join(" ｜ ")}`);

  if (failures.length > 0) {
    out.push(`:warning: 評価に失敗: ${failures.length}件（${failures[0]?.error.slice(0, 120)}）`);
  }

  const hits = scored.filter((s) => s.match.totalPct >= notifyTotalMin);
  const below = scored.length - hits.length;

  if (hits.length === 0) {
    out.push("");
    out.push(`*総合マッチ度${notifyTotalMin}%以上の新着はありません。*`);
    out.push(
      `（評価した${scored.length}件はいずれも${notifyTotalMin}%未満 / ハードフィルタで${dropped.length}件除外）`,
    );
    return out.join("\n");
  }

  out.push("");
  out.push(`*総合マッチ度${notifyTotalMin}%以上: ${hits.length}件*`);

  for (const { job, evaluation: e, match } of hits) {
    out.push("");
    out.push("──────────");
    out.push(`*<${job.url}|${(job.title || "(無題)").slice(0, 90)}>*`);
    out.push(
      [
        `総合 *${match.totalPct}%*（希望適合 ${match.fitPct}% × 通過可能性 ${match.passPct}%）`,
        rateLabel(job, e.monthlyReading),
        REMOTE_LABEL[e.remoteReading] ?? "不明",
        job.minDaysPerWeek ? `週${job.minDaysPerWeek}日` : "稼働日数記載なし",
      ].join(" ｜ "),
    );
    if (e.requirementsTotal > 0) {
      out.push(
        `  必須要件 ${e.requirementsMet}/${e.requirementsTotal}件` +
          (e.requirementsMissing.length
            ? `（不足: ${e.requirementsMissing.slice(0, 2).join(" / ")}）`
            : ""),
      );
    }
    if (job.hasSettlement) {
      const range =
        job.settlementMinHours && job.settlementMaxHours
          ? `${job.settlementMinHours}〜${job.settlementMaxHours}h`
          : "精算幅あり";
      // 精算基準時間は普通に書かれているものなので、警告ではなく事実として出す
      out.push(`  精算基準時間 ${range}`);
    }
    if (e.verdict) out.push(`> ${e.verdict}`);
    for (const r of e.reasons.slice(0, 3)) out.push(`  ・${r}`);
    if (e.stackOverlap.length > 0) {
      out.push(`  重なる技術: ${e.stackOverlap.slice(0, 8).join(" / ")}`);
    }
    const pm = PM_LABEL[e.pmValue];
    if (pm) out.push(`  PM要素: ${pm}`);
    for (const c of e.concerns.slice(0, 3)) out.push(`  :warning: ${c}`);
  }

  out.push("");
  out.push(
    `${notifyTotalMin}%未満: ${below}件 ｜ ハードフィルタ除外: ${dropped.length}件`,
  );
  return out.join("\n");
}

/** スレッドに返す「なぜ落としたか」。criteria をチューニングするための材料。 */
export function buildDroppedDetail(dropped: Dropped[], limit = 30): string | null {
  if (dropped.length === 0) return null;
  const lines = [
    `*ハードフィルタで除外した${dropped.length}件*（条件を直すなら \`criteria.json\`）`,
  ];
  for (const d of dropped.slice(0, limit)) {
    lines.push(
      `• ${d.reason} ｜ ${rateLabel(d.job)} ｜ <${d.job.url}|${(d.job.title || "").slice(0, 60)}>`,
    );
  }
  if (dropped.length > limit) lines.push(`…ほか${dropped.length - limit}件`);
  return lines.join("\n");
}
