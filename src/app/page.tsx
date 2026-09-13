import { Views } from "./_components/Views";

/** 今日の日付（JST） */
function todayJst(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${w}）`;
}

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-10 sm:px-8">
      <header className="mb-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="bg-teal text-teal-on rounded-btn flex h-9 w-9 items-center justify-center text-base font-bold"
            >
              ◎
            </span>
            <h1 className="text-lg font-bold tracking-tight">案件レーダー</h1>
          </div>
          <p className="text-muted tnum text-xs">{todayJst()}</p>
        </div>
        <p className="text-muted mt-3 text-[13px] leading-relaxed">
          公開案件と担当者メールを毎朝1回集めて、経歴と希望条件で採点する。
          通知しなかったものも条件で除外したものも、理由つきで残る。
        </p>
      </header>
      <Views />
    </main>
  );
}
