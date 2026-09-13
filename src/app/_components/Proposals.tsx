"use client";

/**
 * 担当者提案タブ。
 *
 * ここだけ他のタブと役割が違う。**押したら実際に商談希望が出る**画面なので、
 *   1. 日程の材料（不可日・カレンダー）が揃っているかを先に見せる
 *   2. 提案ごとに採点と下書き（200字）をそのまま見せる
 *   3. 何件に出すのかを数えて、もう一度確認してから確定する
 * の順に並べている。押してから気づくことを無くすための順番。
 *
 * 送信自体はこの画面ではしない。媒体の管理画面が認証の内側にある場合は
 * ログイン済みの実ブラウザからしか送れないため、ここでは「送っていい」を記録する。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  ActionButton,
  JobLink,
  MatchBars,
  Rate,
  RemoteLabel,
  MissingRequirements,
  RequirementsLabel,
  ScoreBreakdown,
  SourceChip,
  ScoreBadge,
  type Breakdown,
  SettlementLabel,
} from "./ui";

type Job = {
  id: string;
  uid: string;
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
  startOn: string | null;
  stage: string;
  dropReason: string | null;
  filterNote: string | null;
  fitPct: number | null;
  passPct: number | null;
  totalPct: number | null;
  fitBreakdown: Breakdown[] | null;
  passBreakdown: Breakdown[] | null;
  requirementsMet: number | null;
  requirementsTotal: number | null;
  requirementsMissing: string[] | null;
  verdict: string | null;
  concerns: string[] | null;
  remoteReading: string | null;
  draftText: string | null;
  sendRequestedAt: string | null;
  sentAt: string | null;
  sendError: string | null;
};

type Availability = {
  config: { unavailableDates: string[]; allowWithoutCalendar: boolean; leadDays: number };
  calendars: string[];
  slots: { label: string; start: string }[];
  busyCount: number;
  refusedReason: string | null;
  warnings: string[];
  error?: string;
};

/** 送信できる状態か。下書きが無いもの・送信済みは対象にしない */
const sendable = (j: Job) => j.stage === "SCORED" && !j.sentAt && Boolean(j.draftText);

/**
 * 既定で商談希望を出す対象。
 *
 * 担当者が経歴を見て選んで送ってきた提案なので、**基本は全部出す**。
 * 1件ずつ選ばせない（選ぶ手間をかけるほどの差が無いし、
 * 選ばなかった理由も残らない）。
 * ただし希望条件と合わない点があるもの（単価が下限未満など）は既定から外し、
 * 出すかどうかをまとめて1回決められるようにする。
 */
const defaultTarget = (j: Job) => sendable(j) && !j.filterNote;

function Panel({ children, tone = "plain" }: { children: React.ReactNode; tone?: string }) {
  const border =
    tone === "warn" ? "border-amber-pale" : tone === "alert" ? "border-coral-pale" : "border-line";
  return (
    <div className={`bg-card rounded-card shadow-soft border ${border} p-5`}>{children}</div>
  );
}

/** 参照するGoogleカレンダーの登録。複数アカウントぶん並べられる */
function Calendars() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["calendars"],
    queryFn: async (): Promise<{
      calendars: { name: string; masked: string; editable: boolean }[];
    }> => (await fetch("/api/calendars")).json(),
  });

  const add = useMutation({
    mutationFn: async (vars: { name: string; url: string }) => {
      const res = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error));
      return json;
    },
    onSuccess: () => {
      setUrl("");
      setName("");
      setError(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (n: string) => {
      await fetch("/api/calendars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  const list = data?.calendars ?? [];

  return (
    <div className="border-line mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted text-xs">参照するGoogleカレンダー（{list.length}件）</p>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-teal-ink text-xs underline"
        >
          {open ? "閉じる" : "設定する"}
        </button>
      </div>

      {list.length > 0 && (
        <ul className="mt-2 space-y-1">
          {list.map((c) => (
            <li key={c.name} className="flex items-center gap-2 text-xs">
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted">{c.masked}</span>
              {c.editable ? (
                <button
                  type="button"
                  onClick={() => remove.mutate(c.name)}
                  className="text-coral-ink underline"
                >
                  外す
                </button>
              ) : (
                <span className="text-muted">環境変数で設定</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="bg-panel rounded-tag mt-3 px-4 py-3">
          <p className="text-muted text-[11px] leading-relaxed">
            Googleカレンダー → カレンダー名の「⋮」→ 設定と共有 → 一番下「カレンダーの統合」→
            <span className="font-bold">iCal形式の非公開URL</span> をそのまま貼る。
            アカウントごとに1本ずつ登録できます。予定の件名は取り込まず、空き時間の判定だけに使います。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="表示名（個人・仕事など）"
              className="border-line rounded-btn w-40 border px-2 py-1 text-xs"
            />
            <input
              type="password"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              className="border-line rounded-btn min-w-0 flex-1 border px-2 py-1 text-xs"
            />
            <ActionButton
              tone="teal"
              disabled={!url || add.isPending}
              onClick={() => add.mutate({ name, url })}
            >
              {add.isPending ? "確認している…" : "追加して確認"}
            </ActionButton>
          </div>
          {error && (
            <p className="bg-coral-soft text-coral-ink rounded-tag mt-2 px-3 py-2 text-xs">
              {error}
            </p>
          )}
          {add.isSuccess && !error && (
            <p className="text-teal-ink mt-2 text-xs">
              読めました（予定 {String(add.data?.events)}件）
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 不可日と日程候補。ここが埋まっていないと下書きが作れない */
function Schedule() {
  const qc = useQueryClient();
  const [date, setDate] = useState("");

  const { data } = useQuery({
    queryKey: ["availability"],
    queryFn: async (): Promise<Availability> => (await fetch("/api/availability")).json(),
  });

  const patch = useMutation({
    mutationFn: async (vars: { unavailableDates?: string[]; allowWithoutCalendar?: boolean }) => {
      const res = await fetch("/api/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "保存できなかった");
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!data) return null;
  const cfg = data.config;
  const dates = cfg?.unavailableDates ?? [];

  return (
    <Panel tone={data.refusedReason ? "warn" : "plain"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">商談を出せる日</h3>
        <p className="text-muted text-xs">
          {data.calendars.length > 0
            ? `Googleカレンダー ${data.calendars.join(" / ")}（予定 ${data.busyCount}件を除外）`
            : "Googleカレンダー未接続"}
        </p>
      </div>

      {data.refusedReason && (
        <p className="bg-amber-soft text-amber-ink rounded-tag mt-3 px-4 py-3 text-xs leading-relaxed">
          {data.refusedReason}
        </p>
      )}
      {data.warnings.map((w) => (
        <p
          key={w}
          className="bg-amber-soft text-amber-ink rounded-tag mt-3 px-4 py-3 text-xs leading-relaxed"
        >
          {w}
        </p>
      ))}

      {data.slots.length > 0 && (
        <ul className="tnum mt-3 space-y-1 text-sm">
          {data.slots.map((s) => (
            <li key={s.start}>{s.label}</li>
          ))}
        </ul>
      )}

      <div className="border-line mt-4 border-t pt-4">
        <p className="text-muted text-xs">この日は商談を出さない</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {dates.length === 0 && <span className="text-muted text-xs">まだ無い</span>}
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => patch.mutate({ unavailableDates: dates.filter((x) => x !== d) })}
              className="border-coral-pale bg-coral-soft text-coral-ink rounded-tag tnum border px-2 py-0.5 text-xs"
              title="クリックで取り消す"
            >
              {d} ✕
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-line rounded-btn tnum border px-2 py-1 text-xs"
          />
          <ActionButton
            tone="coral"
            disabled={!date || patch.isPending}
            onClick={() => {
              patch.mutate({ unavailableDates: [...dates, date] });
              setDate("");
            }}
          >
            不可日に入れる
          </ActionButton>
          {data.calendars.length === 0 && (
            <label className="text-muted ml-auto flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={cfg?.allowWithoutCalendar ?? false}
                onChange={(e) => patch.mutate({ allowWithoutCalendar: e.target.checked })}
              />
              カレンダーを繋がず、不可日だけで日程を出す
            </label>
          )}
        </div>
      </div>

      <Calendars />
    </Panel>
  );
}

function Row({ job, willSend }: { job: Job; willSend: boolean }) {
  const meta = [
    job.minDaysPerWeek ? `週${job.minDaysPerWeek}日` : null,
    job.startOn ? `開始 ${job.startOn}` : null,
    job.negotiationCount ? `商談${job.negotiationCount}回` : null,
  ].filter(Boolean);

  return (
    <article
      className={`bg-card rounded-card shadow-soft border p-6 transition ${
        willSend ? "border-teal-pale" : "border-line"
      }`}
    >
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

      {job.filterNote && (
        <p className="bg-amber-soft text-amber-ink rounded-tag mt-3 px-4 py-2 text-xs leading-relaxed">
          <span className="font-bold">希望条件と合わない点</span>　{job.filterNote}
          <br />
          担当者が選んだ提案なので採点はしています。既定では商談希望を出しません。
        </p>
      )}

      {job.sentAt && (
        <p className="bg-teal-soft text-teal-ink rounded-tag mt-3 px-4 py-2 text-xs">
          送信済み（{new Date(job.sentAt).toLocaleString("ja-JP")}）
        </p>
      )}
      {job.sendError && (
        <p className="bg-coral-soft text-coral-ink rounded-tag mt-3 px-4 py-2 text-xs leading-relaxed">
          送信に失敗　{job.sendError}
        </p>
      )}
      {!job.sentAt && job.sendRequestedAt && (
        <p className="bg-amber-soft text-amber-ink rounded-tag mt-3 px-4 py-2 text-xs">
          送信待ち（{new Date(job.sendRequestedAt).toLocaleString("ja-JP")} に依頼）
        </p>
      )}

      {job.draftText ? (
        <div className="bg-panel rounded-tag mt-4 px-4 py-3">
          <p className="text-muted text-[11px] font-bold">送る文（{job.draftText.length}字）</p>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
            {job.draftText}
          </pre>
        </div>
      ) : (
        job.stage === "SCORED" && (
          <p className="text-muted mt-4 text-xs">下書きがまだ無い（上の日程が揃うと作れる）</p>
        )
      )}

      {job.concerns && job.concerns.length > 0 && (
        <ul className="bg-coral-soft text-coral-ink rounded-tag mt-4 space-y-1 px-4 py-3 text-sm leading-relaxed">
          {job.concerns.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function Proposals() {
  const qc = useQueryClient();
  const [includeOff, setIncludeOff] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["proposals"],
    queryFn: async (): Promise<{ jobs: Job[]; error?: string }> =>
      (await fetch("/api/proposals")).json(),
  });

  const jobs = data?.jobs ?? [];
  const candidates = useMemo(() => jobs.filter(sendable), [jobs]);
  const scoredCount = jobs.filter((j) => j.stage === "SCORED").length;
  const sent = jobs.filter((j) => j.sentAt).length;

  // 希望条件と合わない点があるもの（単価が下限未満など）は既定から外す
  const offCriteria = useMemo(() => candidates.filter((j) => Boolean(j.filterNote)), [candidates]);
  const selectedJobs = useMemo(
    () => (includeOff ? candidates : candidates.filter(defaultTarget)),
    [candidates, includeOff],
  );

  const post = useMutation({
    mutationFn: async (body: { action: string; ids?: string[] }) => {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error ?? "失敗した"));
      return json;
    },
    onSuccess: (json, vars) => {
      setConfirming(false);
      setMessage(
        vars.action === "send"
          ? `${String(json.requested)}件の送信を依頼した。実ブラウザで送信してスクリーンショットを残す`
          : `下書きを ${String(json.made)}件作った`,
      );
      qc.invalidateQueries();
    },
    onError: (e: Error) => setMessage(e.message),
  });

  if (isLoading) return <p className="text-muted py-12 text-sm">読み込んでいます</p>;

  if (data?.error) {
    return (
      <Panel tone="alert">
        <p className="text-sm font-bold">データベースに接続できていません</p>
        <p className="text-muted mt-1 text-sm">{data.error}</p>
      </Panel>
    );
  }

  // 提案が0件でも日程とカレンダーの設定には入れるようにする
  // （提案が届く前に準備しておけるようにするため）
  if (jobs.length === 0) {
    return (
      <div className="space-y-4">
        <Schedule />
        <Panel>
          <p className="text-sm font-bold">担当者提案がまだありません</p>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            提案ページはログインの内側にあるため、ログイン済みのブラウザで読み取って
            取り込む必要があります。
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Schedule />

      {message && (
        <Panel>
          <p className="text-sm leading-relaxed">{message}</p>
        </Panel>
      )}

      <Panel tone={confirming ? "warn" : "plain"}>
        {confirming ? (
          <div>
            <p className="text-sm font-bold">
              今回の提案 {selectedJobs.length}件について、これで商談希望を出しますが、いいですか？
            </p>
            <ul className="text-muted mt-3 space-y-1 text-xs leading-relaxed">
              {selectedJobs.map((j) => (
                <li key={j.id} className="tnum">
                  {String(j.totalPct).padStart(3)}% {j.title.slice(0, 44)}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-3">
              <ActionButton
                tone="teal"
                active
                disabled={post.isPending}
                onClick={() => post.mutate({ action: "send", ids: selectedJobs.map((j) => j.id) })}
              >
                {post.isPending ? "依頼している…" : "はい、この内容で出す"}
              </ActionButton>
              <ActionButton tone="neutral" onClick={() => setConfirming(false)}>
                やめる
              </ActionButton>
            </div>
          </div>
        ) : candidates.length === 0 ? (
          // 選ぶ手段（各カードのチェックボックス）は下書きがある提案にだけ出る。
          // 下書きが1件も無いときに「0/0件を選んでいる」と出すと、
          // 選ぶUIが無いのに選んでいる話をすることになるので、理由を出す
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-sm font-bold">まだ商談希望を出せません</p>
              <p className="text-muted mt-1 text-xs leading-relaxed">
                {sent > 0 && sent === scoredCount
                  ? "採点した提案はすべて送信済みです。"
                  : "送る文（200字）がまだできていません。上の「商談を出せる日」で" +
                    "カレンダーを登録するか不可日を入れると、日程が決まって下書きができます。"}
              </p>
            </div>
            <div className="ml-auto">
              <ActionButton
                tone="amber"
                disabled={post.isPending}
                onClick={() => post.mutate({ action: "draft" })}
              >
                {post.isPending ? "作っている…" : "下書きを作る"}
              </ActionButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-sm">
                <span className="tnum font-bold">{selectedJobs.length}</span>
                <span className="text-muted">件に商談希望を出す</span>
              </p>
              {offCriteria.length > 0 && (
                <label className="text-muted mt-1.5 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={includeOff}
                    onChange={(e) => setIncludeOff(e.target.checked)}
                  />
                  希望条件と合わない {offCriteria.length}件も出す（
                  {offCriteria.map((j) => j.filterNote?.slice(0, 22)).join(" / ")}）
                </label>
              )}
            </div>
            <ActionButton
              tone="amber"
              disabled={post.isPending}
              onClick={() => post.mutate({ action: "draft" })}
            >
              下書きを作り直す
            </ActionButton>
            <div className="ml-auto">
              <ActionButton
                tone="teal"
                active
                disabled={selectedJobs.length === 0}
                onClick={() => setConfirming(true)}
              >
                商談希望を出す
              </ActionButton>
            </div>
          </div>
        )}
      </Panel>

      <div className="space-y-3">
        {jobs.map((job) => (
          <Row key={job.id} job={job} willSend={selectedJobs.some((j) => j.id === job.id)} />
        ))}
      </div>
    </div>
  );
}
