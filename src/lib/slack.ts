/**
 * Slack 連携（Bot トークン）。
 *
 * 必要な Bot スコープ:
 *   chat:write / channels:history / channels:read
 *   （非公開チャンネルなら groups:history / groups:read）
 */

const API = "https://slack.com/api/";

export class SlackError extends Error {}

async function call(method: string, body: unknown): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new SlackError("SLACK_BOT_TOKEN が設定されていません");

  const res = await fetch(API + method, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new SlackError(`${method}: 非JSON応答`);
  }
  if (!json["ok"]) throw new SlackError(`${method}: ${String(json["error"] ?? "unknown")}`);
  return json;
}

export async function postMessage(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<{ ts?: string }> {
  const json = await call("chat.postMessage", {
    channel,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return { ts: typeof json["ts"] === "string" ? json["ts"] : undefined };
}

export const slackConfigured = (): boolean =>
  Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
