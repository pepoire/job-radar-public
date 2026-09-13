"use client";

/**
 * 総合マッチ度順の一覧。
 * 通知しなかったもの（閾値未満）と条件で除外したものも、理由つきで見られる。
 * criteria をチューニングするには「なぜ落ちたか」を見る必要があるため。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { aging } from "@/lib/aging";

import {
  ActionButton,
  AgingLabel,
  FailedLabel,
  JobLink,
  MatchBars,
  Rate,
  RemoteLabel,
  MissingRequirements,
  RequirementsLabel,
  ScoreBreakdown,
  ScoreBadge,
  type Breakdown,
  SettlementLabel,
  SourceChip,
} from "./ui";

type Job = {
  id: string;
  source: string;
  sourceLabel: string | null;
  sourceChannel: string | null;
  url: string;
  title: string;
  postedOn: string | null;
  monthlyJpy: number | null;
  hourlyJpy: number | null;
  minDaysPerWeek: number | null;
  hasSettlement: boolean;
  settlementMinHours: number | null;
  settlementMaxHours: number | null;
  negotiationCount: number | null;
  paymentSiteDays: number | null;
  startOn: string | null;
  stage: string;
  dropReason: string | null;
  fitPct: number | null;
  passPct: number | null;
  totalPct: number | null;
  fitBreakdown: Breakdown[] | null;
  passBreakdown: Breakdown[] | null;
  requirementsMet: number | null;
  requirementsTotal: number | null;
  requirementsMissing: string[] | null;
  verdict: string | null;
  reasons: string[] | null;
  concerns: string[] | null;
  remoteReading: string | null;
  stackOverlap: string[] | null;
  action: string;
  firstSeenAt: string;
};

/** 色は上の集計バーと揃える（気になる=アンバー / 応募した=コーラル / 見送る=ニュートラル） */
const ACTIONS = [
  { key: "INTERESTED", label: "気になる", tone: "amber" },
  { key: "APPLIED", label: "応募した", tone: "coral" },
  { key: "PASSED", label: "見送る", tone: "neutral" },
] as const;

const TABS = [
  { key: "SCORED_HIGH", label: "応募候補", stage: "SCORED", minTotal: 40 },
  { key: "SCORED", label: "採点した全件", stage: "SCORED", minTotal: 0 },
  { key: "DROPPED", label: "条件で除外", stage: "DROPPED", minTotal: 0 },
  { key: "FAILED", label: "採点できず", stage: "FAILED", minTotal: 0 },
] as const;

function Row({
  job,
  onAction,
  pending,
}: {
  job: Job;
  onAction: (id: string, action: string) => void;
  pending: boolean;
}) {
  const a = aging(job.firstSeenAt, job.action);
  const meta = [
    job.minDaysPerWeek ? `週${job.minDaysPerWeek}日` : null,
    job.startOn ? `開始 ${job.startOn}` : null,
    job.negotiationCount ? `商談${job.negotiationCount}回` : null,
    job.paymentSiteDays ? `支払い${job.paymentSiteDays}日` : null,
  ].filter(Boolean);

  return (
    <article className="bg-card border-line rounded-card shadow-soft border p-6 transition hover:shadow-lift">
      <div className="flex items-start gap-4">
        <ScoreBadge pct={job.totalPct} />
        <div className="min-w-0 flex-1">
          <Rate monthlyJpy={job.monthlyJpy} hourlyJpy={job.hourlyJpy} size="lg" />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RemoteLabel remote={job.remoteReading} />
            <RequirementsLabel met={job.requirementsMet} total={job.requirementsTotal} />
            <SettlementLabel
              hasSettlement={job.hasSettlement}
              min={job.settlementMinHours}
              max={job.settlementMaxHours}
            />
            <AgingLabel aging={a} />
            {job.stage === "FAILED" && <FailedLabel />}
          </div>
          <MissingRequirements missing={job.requirementsMissing} />
          <MatchBars fitPct={job.fitPct} passPct={job.passPct} />
        </div>
      </div>

      <h2 className="mt-4 text-[15px] leading-snug">
        <JobLink href={job.url}>{job.title || "（無題）"}</JobLink>
      </h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SourceChip sourceLabel={job.sourceLabel} channel={job.sourceChannel} />
        <p className="text-muted text-xs">{meta.join(" ・ ")}</p>
      </div>

      {job.verdict && <p className="mt-3 text-sm leading-relaxed">{job.verdict}</p>}

      <ScoreBreakdown
        fitPct={job.fitPct}
        passPct={job.passPct}
        totalPct={job.totalPct}
        fitBreakdown={job.fitBreakdown}
        passBreakdown={job.passBreakdown}
      />

      {job.dropReason && (
        <p className="text-muted mt-3 text-sm">
          <span className="font-bold">除外理由</span>　{job.dropReason}
        </p>
      )}

      {job.reasons && job.reasons.length > 0 && (
        <ul className="text-muted mt-3 space-y-1 text-sm leading-relaxed">
          {job.reasons.map((x) => (
            <li key={x} className="pl-4 -indent-4">
              — {x}
            </li>
          ))}
        </ul>
      )}

      {job.concerns && job.concerns.length > 0 && (
        <ul className="bg-coral-soft text-coral-ink rounded-tag mt-4 space-y-1 px-4 py-3 text-sm leading-relaxed">
          {job.concerns.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {job.stackOverlap && job.stackOverlap.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {job.stackOverlap.map((s) => (
              <span
                key={s}
                className="border-line text-muted rounded-tag bg-panel border px-2 py-0.5 text-xs"
              >
                {s}
              </span>
            ))}
          </p>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs">
          {ACTIONS.map((x) => (
            <ActionButton
              key={x.key}
              disabled={pending}
              active={job.action === x.key}
              tone={x.tone}
              onClick={() => onAction(job.id, job.action === x.key ? "UNTOUCHED" : x.key)}
            >
              {x.label}
            </ActionButton>
          ))}
        </div>
      </div>
    </article>
  );
}

export function JobList() {
  const [tabKey, setTabKey] = useState<string>(TABS[0].key);
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs", tab.stage, tab.minTotal],
    queryFn: async (): Promise<{
      jobs: Job[];
      counts?: Record<string, number>;
      error?: string;
    }> => {
      const res = await fetch(`/api/jobs?stage=${tab.stage}&minTotal=${tab.minTotal}`);
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

  const counts = data?.counts ?? {};

  return (
    <div>
      <nav className="border-line mb-5 flex flex-wrap gap-x-6 border-b text-sm">
        {TABS.map((t) => {
          const n = counts[t.key];
          const active = t.key === tab.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTabKey(t.key)}
              className={`-mb-px border-b-2 pb-2.5 transition ${
                active
                  ? "border-teal-ink text-teal-ink font-bold"
                  : "text-muted hover:text-ink border-transparent"
              }`}
            >
              {t.label}
              {n !== undefined && <span className="tnum text-muted ml-1.5 text-xs">{n}</span>}
            </button>
          );
        })}
      </nav>

      {isLoading && <p className="text-muted py-12 text-sm">読み込んでいます</p>}

      {(error || data?.error) && (
        <div className="bg-card border-coral-pale rounded-card shadow-soft border p-5 text-sm">
          <p className="font-bold">データベースに接続できていません</p>
          <p className="text-muted mt-1 leading-relaxed">
            <code>DATABASE_URL</code> を設定して <code>pnpm local:db</code> を実行してください。
            取得と採点だけなら <code>pnpm radar preview</code> でデータベース無しでも試せます。
          </p>
        </div>
      )}

      {data && !data.error && data.jobs.length === 0 && (
        <div className="bg-card border-line rounded-card shadow-soft border p-10">
          <p className="font-bold">
            {tab.key === "SCORED_HIGH"
              ? "今日の応募候補はありません"
              : "該当する案件はありません"}
          </p>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            {tab.key === "SCORED_HIGH" ? (
              <>
                取得と採点は動いています。条件を満たす案件が無かっただけです。
                <br />
                裾野を広げるなら <code>criteria.json</code> の下限単価か{" "}
                <code>notifyTotalMin</code> を下げます。
              </>
            ) : (
              <>まだ取得していないか、この条件に当てはまる案件がありません。</>
            )}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {(data?.jobs ?? []).map((job) => (
          <Row
            key={job.id}
            job={job}
            pending={patch.isPending}
            onAction={(id, action) => patch.mutate({ id, action })}
          />
        ))}
      </div>
    </div>
  );
}
