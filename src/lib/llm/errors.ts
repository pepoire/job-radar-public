/**
 * LLM 呼び出しの失敗を種類ごとに分ける。
 *
 * 入力不備とモデル側の失敗を別の型にする。混ぜると、前者をリトライで
 * 潰そうとして無駄に金を使い、後者を入力のせいにして直せなくなる。
 */

/** モデル側の失敗（ネットワーク・レート制限・5xx）。リトライの対象。 */
export class LLMError extends Error {
  readonly kind = "llm" as const;
}

/** 入力が要件を満たしていない。リトライしても直らないので即座に止める。 */
export class PromptInputError extends Error {
  readonly kind = "input" as const;
}

/** モデルが要求したスキーマで返さなかった。リトライ1回まで。 */
export class LLMSchemaError extends Error {
  readonly kind = "schema" as const;
}
