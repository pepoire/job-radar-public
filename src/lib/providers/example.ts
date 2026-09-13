/**
 * 取得 provider の例。fixtures を読むだけで、どこにも接続しない。
 *
 * 自分の環境で動かすときは、この形に合わせて provider を1つ書けばよい。
 * 契約は types.ts の JobProvider だけで、そこから先（ハードフィルタ・採点・
 * 保存・通知・画面）は媒体を知らないので手を入れる必要がない。
 *
 *   export class MyProvider implements JobProvider {
 *     readonly name = "my-source";
 *     async fetch(seenUids: ReadonlySet<string>): Promise<FetchResult> { ... }
 *   }
 *
 * 守ってほしいのは1点だけ。**取得できなかったことを「0件」に丸めない。**
 * status に no_data（公開されていない）と failed（壊れた）を必ず分けて返す。
 * これを混ぜると、サイトの作りが変わって取れなくなった日に
 * 「今日は新着なしです」と報告し続けることになる。
 */

import fs from "node:fs";
import path from "node:path";

import type { FetchResult, JobProvider, RawJob } from "./types";
import { nowJstIso } from "./types";

const FILE = path.join(process.cwd(), "fixtures", "demo.json");

export class ExampleProvider implements JobProvider {
  readonly name = "example";

  constructor(private readonly file = FILE) {}

  async fetch(seenUids: ReadonlySet<string>): Promise<FetchResult> {
    const sources = [
      {
        type: "fixture",
        url: `file://${this.file}`,
        retrievedAt: nowJstIso(),
        confidence: "parsed" as const,
        note: "サンプルデータ",
      },
    ];

    if (!fs.existsSync(this.file)) {
      return {
        status: "not_configured",
        jobs: [],
        checked: 0,
        error: `${path.relative(process.cwd(), this.file)} が無い`,
        sources,
      };
    }

    let parsed: { jobs?: RawJob[] };
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as typeof parsed;
    } catch (e) {
      // 壊れているときは failed。「0件」にしない
      return {
        status: "failed",
        jobs: [],
        checked: 0,
        error: `demo.json が読めない: ${String(e)}`,
        sources,
      };
    }

    const all = parsed.jobs ?? [];
    return {
      status: "ok",
      jobs: all.filter((j) => !seenUids.has(j.uid)),
      checked: all.length,
      sources,
    };
  }
}
