/**
 * 経過日数と、その強さの判定。
 *
 * なぜ「作業開始日」ではなく「初回取得からの経過日数」を使うか:
 *   案件票に応募期限は書かれていない。作業開始日は代理指標になりそうだが、
 *   実データでは過去日付（2024/10/01）のまま放置されている案件があり信用できない。
 *   案件票の掲載日（JSON-LD の datePosted）も、40件すべてが「今日」になっていた
 *   ＝サイト側が毎日更新しているため、初掲載日として使えない。
 *   したがって「レーダーが初めて拾った日」を唯一信用できる起点とする。
 *
 * なぜ未着手では数えないか:
 *   未着手は「まだ見ていない」だけで、放置が問題になるのは自分が
 *   「気になる」と判断してから。未着手に日数を出すと全件に数字が付いて意味が薄れる。
 *
 * なぜ応募済みでは警告色にしないか:
 *   応募したあとは返事を待つしかなく、自分にできることが無い。
 *   そこを赤くしても行動が変わらないので、日数だけ出してグレーのままにする。
 *   警告色にするのは「気になる」で止まっているものだけ。
 */

export type AgingLevel = "none" | "watch" | "stale";

export type Aging = {
  days: number;
  level: AgingLevel;
  label: string;
};

/** 日付だけを見て日数差を出す（時刻の差で1日ずれないように JST の日付に丸める） */
export function daysBetween(from: Date, to: Date): number {
  const toJstDay = (d: Date) =>
    Math.floor((d.getTime() + 9 * 3600 * 1000) / (24 * 3600 * 1000));
  return toJstDay(to) - toJstDay(from);
}

/**
 * 経過日数の判定。action が UNTOUCHED / PASSED のときは null を返す。
 *   - PASSED は自分で閉じたので急ぐ必要がない
 *   - UNTOUCHED はまだ判断していないので数えない
 * APPLIED は日数を出すが、強さは常に "none"（返事待ちで打つ手が無いため）。
 */
export function aging(
  firstSeenAt: Date | string,
  action: string,
  now: Date = new Date(),
): Aging | null {
  if (action === "UNTOUCHED" || action === "PASSED") return null;

  const from = typeof firstSeenAt === "string" ? new Date(firstSeenAt) : firstSeenAt;
  if (Number.isNaN(from.getTime())) return null;

  const days = Math.max(0, daysBetween(from, now));
  const label = days === 0 ? "今日" : `${days}日経過`;

  // 応募済みは自分にできることが無いので急かさない
  if (action === "APPLIED") return { days, level: "none", label };

  const level: AgingLevel = days >= 8 ? "stale" : days >= 4 ? "watch" : "none";
  return { days, level, label };
}
