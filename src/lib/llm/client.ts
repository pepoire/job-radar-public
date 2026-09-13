/**
 * LLM アダプタ。
 *
 * 既定は **claude-code**（手元の Claude Code CLI を呼ぶ）。
 * APIキーを1つも持たずに動くのがこの構成の要点。
 * 公開用リポジトリでも、鍵を配らずにそのまま動く。
 *
 *   claude-code  手元の `claude -p` を呼ぶ。サブスクリプションで動く。鍵不要
 *   openai       OPENAI_API_KEY が要る
 *   anthropic    ANTHROPIC_API_KEY が要る
 *
 * 環境変数
 *   JOBRADAR_LLM_ORDER      使う順。既定 "claude-code,openai,anthropic"
 *   JOBRADAR_CLAUDE_MODEL   claude-code で使うモデル
 *   JOBRADAR_OPENAI_MODEL / JOBRADAR_ANTHROPIC_MODEL
 *
 * 静かに null を返さない。取得層と同じで、失敗は失敗として上に伝える。
 */

import { spawn } from "node:child_process";

import { LLMError, LLMSchemaError } from "./errors";

/**
 * コマンドを実行して stdout を返す。
 * stdin は即座に閉じる（開いたままだと Claude Code CLI が3秒待って警告を出す）。
 */
function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    });
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.on("data", (d: string) => {
      stderr += d;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} が ${Math.round(timeoutMs / 1000)} 秒で応答しなかった`));
    }, timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Adapter = (
  system: string,
  user: string,
  jsonSchema: object,
) => Promise<{ raw: unknown; model: string }>;

/**
 * 手元の Claude Code CLI を呼ぶ。
 *
 * `--json-schema` で構造化出力を検証させ、`structured_output` を受け取る。
 * CLI は1回の呼び出しごとに自身のシステムプロンプト（実測28,419トークン）を
 * 読み込むので、**呼び出し回数を増やさないこと**が効く。
 * 採点はまとめて1回にしてある（capabilities/evaluate.ts）。
 */
const claudeCode: Adapter = async (system, user, jsonSchema) => {
  const model = process.env.JOBRADAR_CLAUDE_MODEL ?? "claude-sonnet-5";
  const prompt = `${system}\n\n---\n\n${user}`;

  let stdout: string;
  try {
    const res = await run(
      "claude",
      [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(jsonSchema),
        "--model",
        model,
      ],
      15 * 60 * 1000,
    );
    if (res.code !== 0) {
      throw new LLMError(
        `claude -p が終了コード ${res.code}: ${(res.stderr || res.stdout).slice(0, 300)}`,
      );
    }
    stdout = res.stdout;
  } catch (e) {
    if (e instanceof LLMError) throw e;
    const err = e as { code?: string; message?: string };
    if (err.code === "ENOENT") {
      throw new LLMError(
        "claude コマンドが見つからない。Claude Code CLI が入っている環境で実行するか、" +
          "JOBRADAR_LLM_ORDER で openai / anthropic に切り替える",
      );
    }
    throw new LLMError(`claude -p が失敗: ${(err.message ?? String(e)).slice(0, 300)}`);
  }

  let parsed: { structured_output?: unknown; is_error?: boolean; result?: string };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new LLMSchemaError(`claude の出力がJSONではない: ${stdout.slice(0, 200)}`);
  }
  if (parsed.is_error) {
    throw new LLMError(`claude がエラーを返した: ${String(parsed.result).slice(0, 300)}`);
  }
  if (parsed.structured_output === undefined) {
    throw new LLMSchemaError("claude が structured_output を返さなかった");
  }
  return { raw: parsed.structured_output, model: `claude-code/${model}` };
};

const openai: Adapter = async (system, user, jsonSchema) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new LLMError("OPENAI_API_KEY が無い");
  const model = process.env.JOBRADAR_OPENAI_MODEL ?? "gpt-4.1-mini";

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "evaluation", strict: true, schema: jsonSchema },
      },
    }),
  });
  if (!res.ok) throw new LLMError(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new LLMSchemaError("openai が本文を返さなかった");
  try {
    return { raw: JSON.parse(text), model: `openai/${model}` };
  } catch {
    throw new LLMSchemaError(`openai がJSONを返さなかった: ${text.slice(0, 200)}`);
  }
};

const anthropic: Adapter = async (system, user, jsonSchema) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new LLMError("ANTHROPIC_API_KEY が無い");
  const model = process.env.JOBRADAR_ANTHROPIC_MODEL ?? "claude-sonnet-5";

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ name: "report", description: "評価結果を返す", input_schema: jsonSchema }],
      tool_choice: { type: "tool", name: "report" },
    }),
  });
  if (!res.ok) throw new LLMError(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as { content?: { type?: string; input?: unknown }[] };
  const block = json.content?.find((b) => b.type === "tool_use");
  if (!block) throw new LLMSchemaError("anthropic が tool_use を返さなかった");
  return { raw: block.input, model: `anthropic/${model}` };
};

const ADAPTERS: Record<string, Adapter> = { "claude-code": claudeCode, openai, anthropic };

/** 設定されている順。既定は鍵の要らない claude-code から。 */
export function adapterOrder(): string[] {
  return (process.env.JOBRADAR_LLM_ORDER ?? "claude-code,openai,anthropic")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s in ADAPTERS);
}

/**
 * 採点に使える手段があるか。
 * claude-code は鍵が要らないので、CLI があれば常に使える扱いにする。
 */
export const llmAvailable = (): boolean =>
  adapterOrder().length > 0 &&
  (adapterOrder().includes("claude-code") ||
    Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY));

/**
 * 使える adapter を順に試す。全部失敗したら LLMError を投げる。
 * 呼び出し側が zod で検証するので、ここでは形を保証しない。
 */
export async function completeJson(
  system: string,
  user: string,
  jsonSchema: object,
): Promise<{ raw: unknown; model: string }> {
  const errors: string[] = [];

  for (const name of adapterOrder()) {
    const adapter = ADAPTERS[name];
    if (!adapter) continue;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await adapter(system, user, jsonSchema);
      } catch (e) {
        if (e instanceof LLMSchemaError) {
          errors.push(`${name}(schema,${attempt}): ${e.message}`);
          continue;
        }
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
  }
  throw new LLMError(`どのLLMでも評価できなかった / ${errors.join(" | ")}`);
}
