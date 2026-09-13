"use client";

/**
 * 表示の共通部品。
 *
 * 色の使い方（globals.css の配色設計と対で読む）
 *   - ティール=良い / アンバー=中間 / コーラル=注意。参考画像の意味づけに合わせている
 *   - 塗りの上の文字は必ず -on、白や地の上の文字は -ink を使う
 *   - **色だけで状態を表さない。** 必ずラベル文字を添え、
 *     満たしていないものには ⚠ も付ける
 *   - 満たしている条件は静かに、満たしていない条件だけ目立たせる
 */

import type { ReactNode } from "react";

export type Tone = "neutral" | "teal" | "amber" | "coral";

const CHIP: Record<Tone, string> = {
  neutral: "bg-panel border-line text-muted",
  teal: "bg-teal-soft border-teal-pale text-teal-ink",
  amber: "bg-amber-soft border-amber-pale text-amber-ink",
  coral: "bg-coral-soft border-coral-pale text-coral-ink",
};

/** 塗りつぶし。参考画像の統計バーと同じ使い方をする場所だけ。 */
const SOLID: Record<Tone, string> = {
  neutral: "bg-panel text-muted",
  teal: "bg-teal text-teal-on",
  amber: "bg-amber text-amber-on",
  coral: "bg-coral text-coral-on",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

/** 白い角丸チップに色付きの記号。参考画像のアイコンの扱い。 */
export function IconChip({
  tone,
  size = "md",
  children,
}: {
  tone: Tone;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const s = size === "sm" ? "h-8 w-8 text-sm" : "h-11 w-11 text-lg";
  const ink =
    tone === "teal"
      ? "text-teal-ink"
      : tone === "amber"
        ? "text-amber-ink"
        : tone === "coral"
          ? "text-coral-ink"
          : "text-muted";
  return (
    <span
      aria-hidden
      className={`bg-card rounded-btn inline-flex shrink-0 items-center justify-center font-bold leading-none ${s} ${ink}`}
    >
      {children}
    </span>
  );
}

/**
 * 総合マッチ度のバッジ。
 * 総合 = 希望適合度 × 通過可能性。この画面で最初に見るべきものなので塗りで出す。
 */
export function ScoreBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="bg-panel text-muted rounded-btn inline-flex h-14 w-14 shrink-0 items-center justify-center text-xs">
        未
      </span>
    );
  }
  const tone: Tone = pct >= 60 ? "teal" : pct >= 40 ? "amber" : "neutral";
  return (
    <span
      className={`rounded-btn inline-flex h-14 w-14 shrink-0 flex-col items-center justify-center leading-none ${SOLID[tone]}`}
    >
      <span className="tnum text-[20px] font-bold">{pct}</span>
      <span className="mt-0.5 text-[10px] font-semibold opacity-80">%</span>
    </span>
  );
}

/** 適合と通過を細いバーで見せる。どちらが足を引っ張っているか一目で分かるように。 */
export function MatchBars({ fitPct, passPct }: { fitPct: number | null; passPct: number | null }) {
  if (fitPct == null || passPct == null) return null;
  const rows = [
    { label: "希望適合", pct: fitPct, fill: "bg-teal" },
    { label: "通過可能性", pct: passPct, fill: "bg-coral" },
  ];
  return (
    <div className="mt-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-muted w-[4.5rem] shrink-0 text-[10px]">{r.label}</span>
          <span className="bg-panel h-1.5 flex-1 overflow-hidden rounded-full">
            <span className={`block h-full rounded-full ${r.fill}`} style={{ width: `${r.pct}%` }} />
          </span>
          <span className="tnum text-muted w-8 shrink-0 text-right text-[10px]">{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

/** 必須要件の充足。通過可能性の一番大きな材料なので単独で出す。 */
export function RequirementsLabel({
  met,
  total,
}: {
  met: number | null;
  total: number | null;
}) {
  if (total == null || total <= 0) return <Pill>必須要件の記載なし</Pill>;
  const ratio = (met ?? 0) / total;
  const tone: Tone = ratio >= 1 ? "teal" : ratio >= 0.6 ? "amber" : "coral";
  return (
    <Pill tone={tone}>
      {ratio < 0.6 && "⚠ "}必須要件
      <span className="tnum">
        {met ?? 0}/{total}
      </span>
    </Pill>
  );
}

/**
 * 満たしていない必須要件。
 *
 * チップの中に入れない。案件票の文言をそのまま写すので長く、
 * チップは折り返さない作りなのでカードの外にはみ出す（実際にはみ出した）。
 * 幅に合わせて折り返す独立した行にする。
 */
export function MissingRequirements({ missing }: { missing: string[] | null }) {
  if (!missing || missing.length === 0) return null;
  return (
    <p className="text-muted mt-1.5 text-xs leading-relaxed">
      <span className="text-coral-ink font-semibold">不足</span>　{missing.join(" / ")}
    </p>
  );
}

/** リモート可否。満たしているものは静かに、満たしていないものだけ目立たせる。 */
export function RemoteLabel({ remote }: { remote: string | null }) {
  switch (remote) {
    case "FULL":
      return <Pill tone="teal">フルリモート</Pill>;
    case "PARTIAL":
      return <Pill tone="coral">⚠ 出社あり</Pill>;
    case "ONSITE":
      return <Pill tone="coral">⚠ 常駐</Pill>;
    case "UNCLEAR":
      return <Pill>リモート度不明</Pill>;
    default:
      return null;
  }
}

/**
 * 精算基準時間。140〜180h のような記載は業界の標準的な書き方なので、
 * 警告色にしない（注意色にすると普通の案件が全部危なく見える）。
 * 数字だけ事実として出す。
 */
export function SettlementLabel({
  hasSettlement,
  min,
  max,
}: {
  hasSettlement: boolean;
  min: number | null;
  max: number | null;
}) {
  if (!hasSettlement) return null;
  return (
    <Pill tone="neutral">
      精算 <span className="tnum">{min && max ? `${min}〜${max}h` : "あり"}</span>
    </Pill>
  );
}

/** 経過日数。8日以上は注意色。 */
export function AgingLabel({
  aging,
}: {
  aging: { days: number; level: string; label: string } | null;
}) {
  if (!aging) return null;
  if (aging.level === "stale") return <Pill tone="coral">⚠ {aging.label}</Pill>;
  if (aging.level === "watch") return <Pill tone="amber">{aging.label}</Pill>;
  return <Pill>{aging.label}</Pill>;
}

/** 採点に失敗したもの。黙って捨てないので画面にも出す。 */
export function FailedLabel() {
  return <Pill tone="coral">採点に失敗</Pill>;
}

/** 単価。月額と時間単価を混同させない。換算値はそれと分かる形で出す。 */
export function Rate({
  monthlyJpy,
  hourlyJpy,
  size = "base",
}: {
  monthlyJpy: number | null;
  hourlyJpy: number | null;
  size?: "base" | "lg";
}) {
  const big = size === "lg" ? "text-[28px]" : "text-xl";
  if (monthlyJpy != null) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`tnum font-bold leading-none ${big}`}>
          {Math.round(monthlyJpy / 10000)}
        </span>
        <span className="text-muted text-xs">万円／月</span>
      </span>
    );
  }
  if (hourlyJpy != null) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        <span className={`tnum font-bold leading-none ${big}`}>
          {hourlyJpy.toLocaleString("ja-JP")}
        </span>
        <span className="text-muted text-xs">円／時</span>
        <span className="text-muted text-[11px]">
          月160hで約{Math.round((hourlyJpy * 160) / 10000)}万円
        </span>
      </span>
    );
  }
  return <span className="text-muted text-sm">単価の記載なし</span>;
}

/**
 * 取得元。媒体と経路を別のチップに分けて出す。
 *   [媒体名][web]         公開案件を自分で拾ったもの
 *   [媒体名][Gmail]       担当者が個別に送ってきたもの
 *   [媒体名][担当者提案]   担当者が経歴を見て選んだもの
 *
 * 分ける理由は、同じ媒体でも web と Gmail で意味が違うから。
 * web は誰でも応募できるので競合が多く、Gmail は担当者が絞ったあとの玉。
 * 通過可能性の計算でも係数を変えている（scoring.ts）。
 */
export function SourceChip({
  sourceLabel,
  channel,
}: {
  sourceLabel: string | null;
  channel: string | null;
}) {
  const agency = sourceLabel ?? "不明";
  // 経路は3つ。担当者が選んだもの（メール / 提案）は色を付けて目で拾えるようにする。
  // 媒体名では分岐しない。媒体が増えるたびにこの分岐を直すことになるため
  const route =
    channel === "mail"
      ? { text: "Gmail", icon: "\u2709", picked: true }
      : channel === "agent"
        ? { text: "担当者提案", icon: "\u2605", picked: true }
        : { text: "web", icon: "\u25F1", picked: false };
  const base =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${base} bg-panel border-line text-muted`}>{agency}</span>
      <span
        className={
          route.picked
            ? `${base} bg-teal-soft border-teal-pale text-teal-ink`
            : `${base} bg-panel border-line text-muted`
        }
      >
        <span aria-hidden>{route.icon}</span>
        {route.text}
      </span>
    </span>
  );
}

/** リンク。常時下線（色だけでリンクを示さない）。 */
export function JobLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-teal-ink decoration-teal-pale font-bold underline decoration-2 underline-offset-[3px] transition hover:decoration-current"
    >
      {children}
    </a>
  );
}

/**
 * 小さなアクション。
 * 色は上の集計バーと揃える（気になる=アンバー / 応募した=コーラル / 見送る=ニュートラル）。
 * 同じ意味のものが画面内で違う色にならないようにするため。
 */
const ACTION_STYLE: Record<Tone, { active: string; idle: string }> = {
  teal: {
    active: "bg-teal border-teal text-teal-on font-semibold",
    idle: "border-line text-muted hover:border-teal-pale hover:bg-teal-soft hover:text-teal-ink bg-card",
  },
  amber: {
    active: "bg-amber border-amber text-amber-on font-semibold",
    idle: "border-line text-muted hover:border-amber-pale hover:bg-amber-soft hover:text-amber-ink bg-card",
  },
  coral: {
    active: "bg-coral border-coral text-coral-on font-semibold",
    idle: "border-line text-muted hover:border-coral-pale hover:bg-coral-soft hover:text-coral-ink bg-card",
  },
  neutral: {
    active: "bg-panel border-line text-ink font-semibold",
    idle: "border-line text-muted hover:bg-panel hover:text-ink bg-card",
  },
};

export function ActionButton({
  onClick,
  disabled,
  active,
  tone = "teal",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: Tone;
  children: ReactNode;
}) {
  const st = ACTION_STYLE[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-btn border px-3 py-1.5 text-xs transition disabled:opacity-40 ${
        active ? st.active : st.idle
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------------ *
 * 点数の内訳
 *
 * 「なぜ70%なのか」を画面で追えるようにする。
 * 不足している必須要件（赤い行）だけでは説明になっていない。
 * 必須要件5/5でも70%になる案件があり、その30%はドメイン経験の係数で
 * 落ちている。赤い行が空なのに70%だと、理由がどこにも出ていないことになる。
 *
 * 係数を掛けた「途中の値」を順に出す。
 *   100% → 必須要件 ×1.00 → 100% → ドメイン経験 ×0.70 → 70%
 * attribution（何%分がどの要因か）を作ると掛け算では嘘になるので、
 * 走っている値をそのまま見せる。
 * ------------------------------------------------------------------------ */

export type Breakdown = { label: string; factor: number; note: string; bonus?: number };

const pct1 = (n: number) => `${Math.round(n * 100)}%`;

/** いちばん効いている要因（係数がもっとも小さい行） */
export function biggestDrag(breakdown: Breakdown[] | null): Breakdown | null {
  if (!breakdown?.length) return null;
  const dragged = breakdown.filter((b) => b.factor < 0.999);
  if (dragged.length === 0) return null;
  return dragged.reduce((a, b) => (b.factor < a.factor ? b : a));
}

function Chain({ title, value, breakdown }: { title: string; value: number | null; breakdown: Breakdown[] }) {
  let running = 1;
  const rows = breakdown.map((b) => {
    if (b.bonus == null) running *= b.factor;
    return { ...b, after: running };
  });
  const bonus = breakdown.reduce((n, b) => n + (b.bonus ?? 0), 0);

  return (
    <div className="mt-3">
      <p className="text-xs font-bold">
        {title}　<span className="tnum">{value == null ? "—" : `${value}%`}</span>
      </p>
      <table className="mt-1 w-full text-[11px] leading-relaxed">
        <tbody>
          {rows.map((b, i) => (
            <tr key={`${b.label}-${i}`} className="border-line border-b last:border-0">
              <td className="py-1 pr-2 align-top font-semibold whitespace-nowrap">{b.label}</td>
              <td className="text-muted py-1 pr-2 align-top">{b.note}</td>
              <td className="tnum py-1 pr-2 text-right align-top whitespace-nowrap">
                {b.bonus != null ? `+${b.bonus}` : `×${b.factor.toFixed(2)}`}
              </td>
              <td className="tnum text-muted py-1 text-right align-top whitespace-nowrap">
                {b.bonus != null ? "" : pct1(b.after)}
              </td>
            </tr>
          ))}
          {bonus > 0 && (
            <tr>
              <td className="py-1 pr-2 font-semibold">加点のあと</td>
              <td />
              <td />
              <td className="tnum py-1 text-right">
                {value == null ? "—" : `${value}%`}
                {Math.round(running * 100) + bonus > 100 && (
                  <span className="text-muted">（上限100%）</span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 総合マッチ度の内訳。
 * いちばん効いている要因は開かなくても見える位置に出し、
 * 全部の計算は開いたときに見せる（普段は1行で足りる）。
 */
export function ScoreBreakdown({
  fitPct,
  passPct,
  totalPct,
  fitBreakdown,
  passBreakdown,
}: {
  fitPct: number | null;
  passPct: number | null;
  totalPct: number | null;
  fitBreakdown: Breakdown[] | null;
  passBreakdown: Breakdown[] | null;
}) {
  const fit = fitBreakdown ?? [];
  const pass = passBreakdown ?? [];
  if (fit.length === 0 && pass.length === 0) return null;

  // 適合と通過のうち、下げ幅が大きいほうを主因として出す
  const drags = [biggestDrag(fit), biggestDrag(pass)].filter(Boolean) as Breakdown[];
  const main = drags.length ? drags.reduce((a, b) => (b.factor < a.factor ? b : a)) : null;

  return (
    <details className="border-line mt-3 border-t pt-3">
      <summary className="cursor-pointer text-xs">
        {main ? (
          <>
            <span className="text-muted">いちばん効いているのは</span>{" "}
            <span className="font-bold">{main.label}</span>
            <span className="text-muted">（{main.note.replace(/（.*$/, "")}）</span>{" "}
            <span className="tnum text-coral-ink font-bold">×{main.factor.toFixed(2)}</span>
          </>
        ) : (
          <span className="text-muted">下げている要因はない（内訳を見る）</span>
        )}
      </summary>

      {fit.length > 0 && <Chain title="希望適合度" value={fitPct} breakdown={fit} />}
      {pass.length > 0 && <Chain title="通過可能性" value={passPct} breakdown={pass} />}

      <p className="text-muted mt-3 text-[11px]">
        総合 = 希望適合度 <span className="tnum">{fitPct ?? "—"}%</span> × 通過可能性{" "}
        <span className="tnum">{passPct ?? "—"}%</span> ={" "}
        <span className="tnum text-ink font-bold">{totalPct ?? "—"}%</span>
        　この数字は確率ではなく、並べ替えと閾値のための指標です。
      </p>
    </details>
  );
}
