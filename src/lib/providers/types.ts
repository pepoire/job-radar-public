/**
 * 取得 provider の共通契約。
 *
 * 原則:
 *   - 取得失敗は絶対に推測で埋めない。status "failed" として残す。
 *   - すべての結果は出典（url / retrievedAt / confidence）を一緒に持ち回る。
 *   - HTML/API の仕様変更でパースが壊れたとき、「空データ」ではなく
 *     「失敗」として検出されなければならない。
 *
 * この契約が要る理由:
 *   サイトの HTML が変わって 0 件になったのに、静かに「今日は新着なしです」と
 *   報告し続けるのが一番危ない壊れ方。no_data と failed を必ず区別する。
 */

export type RemoteKind = "FULL" | "PARTIAL" | "ONSITE" | "UNCLEAR";

export type Confidence =
  /** JSON-LD / API など機械可読な構造化データ */
  | "structured"
  /** HTML から抜き出した（仕様変更に弱い） */
  | "parsed"
  /** 人が書いて送ってきたもの（担当者メール） */
  | "human";

/**
 * 案件がどの経路で来たか。
 *
 * 媒体名を採点やUIに直接書かないための区分。
 * 採点で効くのは「誰でも見られるものか、担当者が選んで送ってきたものか」だけで、
 * どの媒体かは関係がない。媒体名は sourceLabel として画面に出すだけにする。
 *
 *   web    公開されていて誰でも応募できる
 *   mail   担当者が個別に送ってきたメール
 *   agent  担当者が経歴を見て選んだ提案（媒体の管理画面など）
 */
export type Channel = "web" | "mail" | "agent";

export type Source = {
  type: string;
  url: string;
  retrievedAt: string;
  confidence: Confidence;
  publisher?: string;
  note?: string;
};

/** 1案件の生取得結果。ここでは判断しない（判断は capabilities 側）。 */
export type RawJob = {
  source: string;
  /** 画面に出す媒体名。「〇〇エージェント」など。経路は channel で持つ */
  sourceLabel?: string;
  /** どの経路で来たか。採点と画面はこれだけを見る（媒体名では分岐しない） */
  channel?: Channel;
  /** 媒体内で一意なID。重複排除のキー */
  uid: string;
  url: string;
  title: string;
  postedOn?: string;
  /** 月額（円）。レンジなら下限。書かれていなければ undefined */
  monthlyJpy?: number;
  /** 時間単価（円）。月額と混同しないよう別に持つ */
  hourlyJpy?: number;
  remote?: RemoteKind;
  minDaysPerWeek?: number;
  /** 作業開始日（YYYY-MM-DD）。案件票に応募期限は無いので、期限の代理指標に使う */
  startOn?: string;
  /** 精算条件が「有」か。稼働が減る月に控除が発生するかの判断に使う */
  hasSettlement?: boolean;
  settlementMinHours?: number;
  settlementMaxHours?: number;
  /** 商談回数。決まるまでの時間の目安 */
  negotiationCount?: number;
  /** 支払いサイト（日数） */
  paymentSiteDays?: number;
  /** 最寄り駅。フルリモートでも初日出社があるため拾う */
  station?: string;
  requiredSkills?: string;
  welcomeSkills?: string;
  roleText?: string;
  /** ブリーフ生成に使う原文 */
  body?: string;
};

export type FetchStatus =
  /** 取得成功。0件でも接続とパースは成功している */
  | "ok"
  /** 接続はできたが、対象が公開されていない */
  | "no_data"
  /** ネットワーク/パース失敗（仕様変更の疑い）→ 必ず報告する */
  | "failed"
  /** provider が未設定（認証情報が無い等） */
  | "not_configured";

export type FetchResult = {
  status: FetchStatus;
  jobs: RawJob[];
  /** 一覧で見えた件数（新規かどうかは問わない） */
  checked: number;
  /** 一斉配信として捨てた件数（メールレーンのみ） */
  bulkDropped?: number;
  error?: string;
  sources: Source[];
};

export interface JobProvider {
  readonly name: string;
  /** seenUids に無いものだけを返す。 */
  fetch(seenUids: ReadonlySet<string>): Promise<FetchResult>;
}

export const nowJstIso = (): string => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace("Z", "+09:00");
};

export const todayJst = (): string => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

/** 標準的な月間稼働時間。時間単価しか無い案件を比較するときだけ使う。 */
export const STANDARD_HOURS_PER_MONTH = 160;

/**
 * 単価の比較に使う「月額換算」。
 * 月額が書かれていればそれ、時間単価しか無ければ換算する。
 * 換算値であることを失わないよう converted を返す。
 */
export function monthlyEquivalent(job: {
  monthlyJpy?: number | null;
  hourlyJpy?: number | null;
}): { value: number | null; converted: boolean } {
  if (job.monthlyJpy != null) return { value: job.monthlyJpy, converted: false };
  if (job.hourlyJpy != null) {
    return { value: job.hourlyJpy * STANDARD_HOURS_PER_MONTH, converted: true };
  }
  return { value: null, converted: false };
}
