"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Board } from "./Board";
import { JobList } from "./JobList";
import { Proposals } from "./Proposals";
import { Summary } from "./Summary";

const VIEWS = [
  { key: "board", label: "ボード", hint: "ステータス別。滞留が見える" },
  { key: "list", label: "一覧", hint: "スコア順。除外された案件も見られる" },
  {
    key: "proposals",
    label: "担当者提案",
    hint: "コーディネーターが選んだ案件。ここから商談希望を出す",
  },
] as const;

export function Views() {
  const [view, setView] = useState<string>("board");
  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  // 集計はタブに関係なく同じものを出すので、ここで1回だけ取る
  const { data } = useQuery({
    queryKey: ["counts"],
    queryFn: async (): Promise<{ counts?: Record<string, number> }> => {
      const res = await fetch("/api/jobs?stage=SCORED&minTotal=0");
      return res.json();
    },
  });

  return (
    <div>
      <Summary counts={data?.counts ?? {}} />
      <div className="border-line mb-6 flex flex-wrap items-center gap-1 border-b">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`-mb-px border-b-2 px-3 pb-2.5 text-sm transition ${
              v.key === current.key
                ? "border-teal-ink text-teal-ink font-bold"
                : "text-muted hover:text-ink border-transparent"
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="text-muted ml-2 text-[11px]">{current.hint}</span>
      </div>

      {current.key === "board" ? <Board /> : current.key === "proposals" ? <Proposals /> : <JobList />}
    </div>
  );
}
