/**
 * 手元から動かすための CLI。
 *
 *   pnpm radar doctor              設定と疎通の確認（採点しない）
 *   pnpm radar preview --no-llm    取得とハードフィルタまで（無料・DBも触らない）
 *   pnpm radar preview             LLM採点まで。Slackには出さない
 *   pnpm radar run                 本番。DBに保存し Slack に投稿する

 *   pnpm radar preview --persist         preview の結果を DB に保存する（手元UIで実データを見る）
 *   pnpm radar preview --json out.json   結果をJSONに書き出す
 *   pnpm radar preview --only <媒体名>   媒体を絞る（採点の無駄打ちを避ける）
 */

import fs from "node:fs";

import { adapterOrder, llmAvailable } from "../src/lib/llm/client";
import { runRadar, type RadarMode } from "../src/lib/radar";
import { slackConfigured } from "../src/lib/slack";
import { buildText } from "../src/lib/report";
import { loadCriteria } from "../src/lib/config";

import { loadEnv } from "./env";

loadEnv();

const args = process.argv.slice(2);
const mode = (args[0] ?? "preview") as RadarMode;
const skipLlm = args.includes("--no-llm");
// preview の結果を DB に保存する。手元のUIで実データを見たいとき
const persist = args.includes("--persist");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
// 媒体を絞る。「担当者提案だけ採点し直す」ができないと LLM 呼び出しが無駄になる
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

if (!["run", "preview", "doctor"].includes(mode)) {
  console.error(`不正なコマンド: ${mode}（run / preview / doctor）`);
  process.exit(1);
}

function printEnvCheck(): void {
  console.log("=== 設定の確認 ===");
  const checks: [string, boolean][] = [
    ["SLACK_BOT_TOKEN + SLACK_CHANNEL_ID", slackConfigured()],
    ["採点に使える手段がある", llmAvailable()],
    ["GMAIL_ADDRESS", Boolean(process.env.GMAIL_ADDRESS)],
    ["GMAIL_APP_PASSWORD", Boolean(process.env.GMAIL_APP_PASSWORD)],
    ["DATABASE_URL", Boolean(process.env.DATABASE_URL)],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${name.padEnd(38)} ${ok ? "OK" : "未設定"}`);
  }
  console.log(`  ${"採点の優先順".padEnd(38)} ${adapterOrder().join(" → ")}`);
  const keys: string[] = [];
  if (process.env.OPENAI_API_KEY) keys.push("OPENAI_API_KEY");
  if (process.env.ANTHROPIC_API_KEY) keys.push("ANTHROPIC_API_KEY");
  console.log(
    `  ${"APIキー".padEnd(38)} ${keys.length ? keys.join(" / ") : "無し（claude-code なら不要）"}`,
  );

  for (const f of ["criteria.json", "criteria.md", "career.md"]) {
    const exists = fs.existsSync(f);
    const size = exists ? fs.statSync(f).size : 0;
    console.log(`  ${f.padEnd(38)} ${exists ? "あり" : "なし"} (${size} bytes)`);
  }
  console.log("");
}

async function main(): Promise<void> {
  if (mode === "doctor") printEnvCheck();

  const { PrismaStore } = await import("../src/lib/store");
  const result = await runRadar({
    mode,
    skipLlm,
    ...(only ? { only } : {}),
    ...(limit ? { limit } : {}),
    ...(persist ? { store: new PrismaStore() } : {}),
    log: (s) => console.log(s),
  });

  if (mode === "preview" && !skipLlm) {
    const { hard } = loadCriteria();
    console.log("\n本文プレビュー:\n");
    console.log(
      buildText({
        date: result.date,
        fetchResults: result.fetchResults,
        scored: result.scored,
        dropped: result.dropped,
        failures: result.failures,
        notifyTotalMin: hard.notifyTotalMin,
      }),
    );
  }

  if (jsonPath) {
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          date: result.date,
          fetch: Object.fromEntries(
            Object.entries(result.fetchResults).map(([k, v]) => [
              k,
              { status: v.status, checked: v.checked, new: v.jobs.length, error: v.error ?? null },
            ]),
          ),
          jobs: Object.values(result.fetchResults).flatMap((r) => r.jobs),
          scored: result.scored,
          dropped: result.dropped,
          failures: result.failures,
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n書き出し: ${jsonPath}`);
  }

  if (result.hadFetchFailure) {
    console.error("\n取得に失敗した媒体があります（上の error を確認）");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
