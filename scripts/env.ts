/**
 * .env.local と .env を読んで process.env に入れる。
 *
 * Next.js は自動で読むが、CLI スクリプト（pnpm radar など）は読まない。
 * それに気づかないと「.env.local に入れたのに not_configured のまま」になる。
 * 既に環境変数が設定されている場合は上書きしない（CI での指定を尊重する）。
 */

import fs from "node:fs";

export function loadEnv(files = [".env.local", ".env"]): void {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // 引用符で囲まれていれば外す
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
