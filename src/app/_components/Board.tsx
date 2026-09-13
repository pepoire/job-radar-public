"use client";

/**
 * ステータス別のボード。横スクロールする。
 *
 * 一覧（スコア順）だけでは「気になると判断したあと何が滞留しているか」が見えない。
 * ボタンを押しても押しっぱなしになるのを防ぐための画面。
 *
 * 経過日数は「気になる」以降にだけ出す（未着手と見送りには出さない）。
 * 起点は初回取得日。理由は lib/aging.ts に書いた。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { aging } from "@/lib/aging";

import {
  ActionButton,
  AgingLabel,
  JobLink,
  MatchBars,
  Pill,
  Rate,
  ScoreBadge,
  RemoteLabel,
  MissingRequirements,
  RequirementsLabel,
  SettlementLabel,
  SourceChip,
  type Tone,
} from "./ui";

export type BoardJob = {
  id: string;
  source: string;
  sourceLabel: string | null;
  sourceChannel: string | null;
  url: string;
  title: string;
  monthlyJpy: number | null;
  hourlyJpy: number | null;
  minDaysPerWeek: number | null;
  hasSettlement: boolean;
  settlementMinHours: number | null;
  settlementMaxHours: number | null;
  negotiationCount: number | null;
  fitPct: number | null;
  passPct: number | null;
  totalPct: number | null;
  requirementsMet: number | null;
  requirementsTotal: number | null;
  requirementsMissing: string[] | null;
  verdict: string | null;
  concerns: string[] | null;
  remoteReading: string | null;
  action: string;
  firstSeenAt: string;
};

const COLUMNS = [
  { key: "UNTOUCHED", label: "未着手", hint: "総合40%以上の新着" },
  { key: "INTERESTED", label: "気になる", hint: "経過日数を数える" },
  { key: "APPLIED", label: "応募した", hint: "返事を待っている" },
  { key: "PASSED", label: "見送る", hint: "自分で閉じた" },
] as const;

/** その列から移動できる先。押せる先だけ出す。 */
const MOVES: Record<string, { to: string; label: string; tone: Tone }[]> = {
  UNTOUCHED: [
    { to: "INTERESTED", label: "気になる", tone: "amber" },
    { to: "PASSED", label: "見送る", tone: "neutral" },
  ],
  INTERESTED: [
    { to: "APPLIED", label: "応募した", tone: "coral" },
    { to: "PASSED", label: "見送る", tone: "neutral" },
  ],
  APPLIED: [{ to: "PASSED", label: "見送る", tone: "neutral" }],
  PASSED: [{ to: "UNTOUCHED", label: "戻す", tone: "teal" }],
};

export function Board() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["board"],
    queryFn: async (): Promise<{ jobs: BoardJob[]; error?: string }> => {
      const res = await fetch("/api/jobs?view=board");
      return res.json();
    },
  });

  const patch = useMutation({
    mutationFn: async (vars: { id: string; action: string }) => {
      await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <p className="text-muted py-12 text-sm">読み込んでいます</p>;

  if (error || data?.error) {
    return (
      <div className="bg-card border-coral-pale rounded-card shadow-soft mt-6 border p-5 text-sm">
        <p className="font-bold">データベースに接続できていません</p>
        <p className="text-muted mt-1 leading-relaxed">
          <code>DATABASE_URL</code> を設定して <code>pnpm local:db</code> を実行してください。
        </p>
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  const now = new Date();

  // 滞留しているものを上に出す。未着手は総合マッチ度順。
  const sortFor = (key: string, list: BoardJob[]) =>
    [...list].sort((a, b) => {
      if (key === "UNTOUCHED") {
        return (b.totalPct ?? 0) - (a.totalPct ?? 0);
      }
      const ad = aging(a.firstSeenAt, a.action, now)?.days ?? 0;
      const bd = aging(b.firstSeenAt, b.action, now)?.days ?? 0;
      return bd - ad;
    });

  return (
    <div className="board-scroll -mx-6 overflow-x-auto px-6 pb-4 sm:-mx-8 sm:px-8">
      <div className="flex min-w-max gap-4">
        {COLUMNS.map((col) => {
          const list = sortFor(
            col.key,
            jobs.filter((j) => j.action === col.key),
          );
          const stale = list.filter(
            (j) => aging(j.firstSeenAt, j.action, now)?.level === "stale",
          ).length;

          return (
            <section key={col.key} className="w-[20rem] shrink-0">
              <header className="mb-1 flex items-center gap-2">
                <h2 className="text-sm font-bold">{col.label}</h2>
                <span className="tnum text-muted text-xs">{list.length}</span>
                {stale > 0 && (
                  <span className="ml-auto">
                    <Pill tone="coral">⚠ 滞留 {stale}</Pill>
                  </span>
                )}
              </header>
              <p className="text-muted mb-3 text-[11px]">{col.hint}</p>

              {list.length === 0 && (
                <p className="text-muted border-line rounded-card border border-dashed px-3 py-8 text-center text-xs">
                  なし
                </p>
              )}

              <div className="space-y-3">
                {list.map((job) => {
                  const a = aging(job.firstSeenAt, job.action, now);
                  return (
                    <article
                      key={job.id}
                      className={`bg-card rounded-card shadow-soft border p-4 transition hover:shadow-lift ${
                        a?.level === "stale" ? "border-coral-pale" : "border-line"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <ScoreBadge pct={job.totalPct} />
                        <div className="min-w-0 flex-1">
                          <Rate monthlyJpy={job.monthlyJpy} hourlyJpy={job.hourlyJpy} />
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <AgingLabel aging={a} />
                          </div>
                        </div>
                      </div>

                      <MatchBars fitPct={job.fitPct} passPct={job.passPct} />

                      <div className="mt-3">
                        <SourceChip sourceLabel={job.sourceLabel} channel={job.sourceChannel} />
                      </div>

                      <h3 className="mt-2 text-sm leading-snug">
                        <JobLink href={job.url}>{job.title || "（無題）"}</JobLink>
                      </h3>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <RemoteLabel remote={job.remoteReading} />
                        <RequirementsLabel
                          met={job.requirementsMet}
                          total={job.requirementsTotal}
                        />
                        <SettlementLabel
                          hasSettlement={job.hasSettlement}
                          min={job.settlementMinHours}
                          max={job.settlementMaxHours}
                        />
                        {job.minDaysPerWeek && (
                          <span className="text-muted self-center text-xs">
                            週{job.minDaysPerWeek}日
                          </span>
                        )}
                      </div>

                      <MissingRequirements missing={job.requirementsMissing} />

                      {job.verdict && (
                        <p className="text-muted mt-3 text-xs leading-relaxed">{job.verdict}</p>
                      )}

                      <div className="border-line mt-4 flex gap-2 border-t pt-3">
                        {(MOVES[col.key] ?? []).map((m) => (
                          <ActionButton
                            key={m.to}
                            disabled={patch.isPending}
                            tone={m.tone}
                            onClick={() => patch.mutate({ id: job.id, action: m.to })}
                          >
                            {m.label}
                          </ActionButton>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
