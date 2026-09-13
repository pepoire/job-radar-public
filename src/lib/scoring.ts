/**
 * 最終マッチングの計算。
 *
 * 2つの軸を分けて持ち、掛け合わせる。
 *
 *   希望適合度（fit）   この案件は自分が欲しいものか
 *   通過可能性（pass）  自分がこの案件に通りそうか
 *   総合（total）        fit × pass
 *
 * なぜ掛けるか: 片方が低ければ応募する意味がない。
 * 「欲しいが通らない」も「通るが欲しくない」も、応募する価値は低い。
 * 加重平均にすると片方の低さが隠れるので積にする。
 *
 * --- パーセンテージの扱いについての約束 ---
 *
 * LLM に「78%」と言わせない。LLM が出すのは**数えられること**だけ:
 *   - 必須要件の総数と、そのうち満たしている数
 *   - 絶対条件に違反しているか（リモート / 契約形態 / 職種）
 *   - ドメイン経験があるか
 *   - AI がプロダクトの中核か
 * 重み付けと計算はこのファイルに置く。だから「なぜこの数字か」を人に説明できる。
 *
 * この数字は確率ではない。**並べ替えと閾値のための指標**である。
 * 「37%なら37%の確率で受かる」という意味ではない。
 */

import type { HardCriteria } from "./config";
import type { Evaluation } from "./llm/schema";
import type { RawJob } from "./providers/types";
import { monthlyEquivalent } from "./providers/types";

/** 主軸の技術。ここが重なっているかは単価と同じ重さで見る。 */
const CORE_STACK = ["typescript", "react", "next.js", "nextjs"];

/**
 * 必須要件が1件も書かれていないときの充足率の見なし値。
 * 「分からない」を「満たしている」にも「満たしていない」にも寄せない。
 */
const UNKNOWN_RATIO = 0.5;

/**
 * 充足率の上振れを「判断できない側」に寄せる重み（架空の観測の件数）。
 * 案件票の記載が少ないほど、充足率が UNKNOWN_RATIO に近づく。
 *   1/1 → (1 + 2×0.5) / (1 + 2) = 0.67
 *   3/3 → (3 + 1) / 5 = 0.80
 *   5/5 → (5 + 1) / 7 = 0.86
 * 満点（1.0）には決して届かない。案件票を全部満たしていても
 * 「通る」と言い切れるものではないので、それが正しい。
 * 下振れ側には効かせない（Math.min を取る）。理由は使っている箇所に書いた。
 */
const EVIDENCE_WEIGHT = 2;

export type Breakdown = {
  label: string;
  /** 掛ける係数。加点の行は 1 にして bonus に入れる */
  factor: number;
  note: string;
  /**
   * 足す点数（加点の行だけ）。
   * 画面で「100% → ×0.70 → 70%」と順に見せるとき、
   * 掛ける行と足す行を区別できないと計算を追えないため分けて持つ。
   */
  bonus?: number;
};

export type MatchResult = {
  fitPct: number;
  passPct: number;
  totalPct: number;
  fitBreakdown: Breakdown[];
  passBreakdown: Breakdown[];
};

const clampPct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/**
 * 希望適合度。
 * 絶対条件（フルリモート / 業務委託 / 開発主体）に違反していたら強く下げるが、
 * 0にはしない。出社頻度や条件次第で検討の余地が残るため、
 * 「見えなくする」のではなく「下に沈める」扱いにする。
 */
export function computeFit(
  job: RawJob,
  ev: Evaluation,
  hard: HardCriteria,
  targetMonthlyJpy: number,
): { pct: number; breakdown: Breakdown[] } {
  const breakdown: Breakdown[] = [];
  let factor = 1;

  const blockers = ev.absoluteBlockers.filter((b) => b !== "NONE");
  if (blockers.length > 0) {
    const f = 0.35;
    factor *= f;
    breakdown.push({
      label: "絶対条件の違反",
      factor: f,
      note: blockers.join(" / "),
    });
  }

  // 単価。目標に届いていれば満点、下限未満は大きく下げる
  const { value: monthly } = monthlyEquivalent(job);
  const floor = hard.minMonthlyJpy;
  let rateFactor: number;
  let rateNote: string;
  if (monthly == null) {
    rateFactor = 0.75;
    rateNote = "単価の記載が無いため判断を保留";
  } else if (monthly >= targetMonthlyJpy) {
    rateFactor = 1;
    rateNote = `${Math.round(monthly / 10000)}万円（目標${Math.round(targetMonthlyJpy / 10000)}万円以上）`;
  } else if (monthly >= floor) {
    rateFactor = 0.85;
    rateNote = `${Math.round(monthly / 10000)}万円（目標未満だが下限以上）`;
  } else {
    rateFactor = 0.5;
    rateNote = `${Math.round(monthly / 10000)}万円（下限未満）`;
  }
  factor *= rateFactor;
  breakdown.push({ label: "単価", factor: rateFactor, note: rateNote });

  // 技術。主軸が重なっているか
  const overlap = ev.stackOverlap.map((s) => s.toLowerCase());
  const hasCore = overlap.some((s) => CORE_STACK.some((c) => s.includes(c)));
  const stackFactor = hasCore ? 1 : overlap.length > 0 ? 0.8 : 0.55;
  factor *= stackFactor;
  breakdown.push({
    label: "技術の重なり",
    factor: stackFactor,
    note: hasCore
      ? `主軸が一致（${ev.stackOverlap.slice(0, 3).join(" / ")}）`
      : overlap.length > 0
        ? `周辺のみ一致（${ev.stackOverlap.slice(0, 3).join(" / ")}）`
        : "重なる技術が無い",
  });

  // 加点。掛けるのではなく足す（上振れの余地を作る）
  let bonus = 0;
  if (ev.aiCore === "CORE") {
    bonus += 10;
    breakdown.push({ label: "AIが中核", factor: 1, note: "プロダクトの中核がAI", bonus: 10 });
  }
  if (ev.pmValue === "CAREER_BUILDING") {
    bonus += 5;
    breakdown.push({ label: "PM実績として書ける", factor: 1, note: "職務経歴書に書ける", bonus: 5 });
  }
  if (job.minDaysPerWeek != null && job.minDaysPerWeek <= 4) {
    bonus += 5;
    breakdown.push({ label: "週4日以下", factor: 1, note: "休みが取りやすい", bonus: 5 });
  }
  // 精算条件（精算基準時間 140〜180h など）は点数に入れない。
  // 業界の標準的な書き方で、これがあること自体は不利ではない。
  // 加点にすると「精算なし」の案件だけが5点得をして、普通の案件が相対的に損をする。

  return { pct: clampPct(factor * 100 + bonus), breakdown };
}

/**
 * 通過可能性。
 * 必須要件の充足率を軸に、ドメイン経験・競合の多さ・商談回数で調整する。
 */
export function computePass(
  job: RawJob,
  ev: Evaluation,
): { pct: number; breakdown: Breakdown[] } {
  const breakdown: Breakdown[] = [];

  // 必須要件の充足率。案件票に列挙されているので数えられる
  let reqFactor: number;
  let reqNote: string;
  if (ev.requirementsTotal <= 0) {
    reqFactor = 0.2 + 0.8 * UNKNOWN_RATIO;
    reqNote = "必須要件が案件票に列挙されていないため判断できない";
  } else {
    // 充足率をそのまま掛けると 0/3 で通過0%になるが、それは言い過ぎ。
    // 必須要件を満たしていなくても書類で見てもらえる可能性はゼロではないので、
    // 下限0.2を置いて 0.2〜1.0 の幅にする。
    //
    // さらに、**件数が少ないときは満点に振り切らせない**。
    // 「TypeScript経験」1項目だけの案件票で 1/1 を満点にすると、
    // 5項目を全部満たした案件票と同じ数字になる。実際に起きた:
    //   オープンポジション（必須1項目・業務内容も不明）   1/1 → 95%
    //   生成AIツール（必須3項目すべて満たす）          3/3 → 95%
    // 情報が少ない＝判断できないのに、数えるほど不利という逆向きの構造だった。
    // 架空の観測を EVIDENCE_WEIGHT 件ぶん足して「判断できない側」に寄せる。
    //
    // **抑えるのは上振れだけにする（min を取る）。**
    // 「不足している要件が挙がっている」のは観測された事実で、
    // 件数が少なくても不確かではない（経歴に無い要件が具体的に1つある）。
    // 一方「全部満たしている」は不足が観測されなかっただけで、
    // 記載が薄い案件票では何も言っていないのと同じ。
    // だから 0/2 のような案件は素直に低いままにする。
    const raw = ev.requirementsMet / ev.requirementsTotal;
    const shrunk =
      (ev.requirementsMet + EVIDENCE_WEIGHT * UNKNOWN_RATIO) /
      (ev.requirementsTotal + EVIDENCE_WEIGHT);
    const ratio = Math.min(raw, shrunk);
    reqFactor = 0.2 + 0.8 * ratio;
    reqNote = `${ev.requirementsMet} / ${ev.requirementsTotal} 件を満たす`;
    if (ev.requirementsTotal <= 2) {
      reqNote += `（案件票の記載が${ev.requirementsTotal}件しかなく、判断の材料が少ない）`;
    }
    if (ev.requirementsMissing.length > 0) {
      reqNote += `（不足: ${ev.requirementsMissing.slice(0, 2).join(" / ")}）`;
    }
  }
  breakdown.push({ label: "必須要件の充足", factor: reqFactor, note: reqNote });
  let factor = reqFactor;

  // ドメイン経験。
  //
  // **案件票が実際に求めているときだけ強く効かせる。**
  // 手元の実データで数えたところ、必須スキルが取れている75件のうち
  // ドメイン経験に言及しているのは9件（12%）だけだった。
  // それにもかかわらず採点済み40件の85%が「未経験の業界」判定になり、
  // 一律で ×0.70 がかかっていた。85%にかかる係数は順位を付けず、
  // 全体を下げるだけで役に立たない。
  //
  // さらに、案件票がドメイン経験を求めている場合、それは必須要件の1項目として
  // 書かれているので「必須要件の充足」に既に数えられている。
  // そこへ係数でも引くと同じことを二重に引くことになる。
  // だから求められているときも控えめにする。
  const required = ev.domainRequired;
  const domainFactor =
    ev.domainExperience === "HAVE"
      ? 1
      : required
        ? ev.domainExperience === "PARTIAL"
          ? 0.95
          : 0.85
        : ev.domainExperience === "PARTIAL"
          ? 1
          : 0.95;
  factor *= domainFactor;
  breakdown.push({
    label: "ドメイン経験",
    factor: domainFactor,
    note:
      ev.domainExperience === "HAVE"
        ? "経験のある業界"
        : required
          ? ev.domainExperience === "PARTIAL"
            ? "案件票がドメイン経験を求めており、近い業界の経験がある"
            : "案件票がドメイン経験を求めているが未経験の業界"
          : ev.domainExperience === "PARTIAL"
            ? "案件票はドメイン経験を求めていない（近い業界の経験がある）"
            : "案件票はドメイン経験を求めていない（未経験の業界）",
  });

  // 競合の多さ。公開案件は誰でも見られるので競合が多い。
  // 担当者が選んで送ってきた案件は、その時点で絞られている。
  // 1.0を超える係数は置かない（上限に張り付いて内訳が読めなくなるため）。
  // 担当者が選んで送ってきたもの（個別メール / 管理画面の提案）は
  // その時点で母数が絞られているので 1.0。公開案件は 0.85。
  // 媒体名では分岐しない。媒体が増えるたびにこのファイルを直すことになるため
  const picked = job.channel === "mail" || job.channel === "agent";
  const sourceFactor = picked ? 1 : 0.85;
  factor *= sourceFactor;
  breakdown.push({
    label: "競合の多さ",
    factor: sourceFactor,
    note: picked
      ? job.channel === "mail"
        ? "担当者からの個別メール"
        : "担当者が選んだ提案（経歴を見て送られている）"
      : "公開案件（誰でも応募できる）",
  });

  // 商談回数。多いほど途中で落ちる機会が増える
  const n = job.negotiationCount;
  const negFactor = n == null ? 1 : n <= 1 ? 1 : n === 2 ? 0.95 : 0.85;
  if (n != null) {
    factor *= negFactor;
    breakdown.push({ label: "商談回数", factor: negFactor, note: `${n}回` });
  }

  return { pct: clampPct(factor * 100), breakdown };
}

export function computeMatch(
  job: RawJob,
  ev: Evaluation,
  hard: HardCriteria,
  targetMonthlyJpy: number,
): MatchResult {
  const fit = computeFit(job, ev, hard, targetMonthlyJpy);
  const pass = computePass(job, ev);
  return {
    fitPct: fit.pct,
    passPct: pass.pct,
    totalPct: clampPct((fit.pct * pass.pct) / 100),
    fitBreakdown: fit.breakdown,
    passBreakdown: pass.breakdown,
  };
}

/** Slack で短く出すための帯。総合の％から導く。 */
export function band(totalPct: number): { label: string; type: "green" | "blue" | "grey" } {
  if (totalPct >= 60) return { label: "応募すべき", type: "green" };
  if (totalPct >= 40) return { label: "検討に値する", type: "blue" };
  return { label: "低マッチ", type: "grey" };
}
