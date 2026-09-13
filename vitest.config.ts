import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // 取得もDBも触らない純粋関数だけを対象にする。
    // ネットワークに依存するテストは CI で不安定になるので置かない。
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
