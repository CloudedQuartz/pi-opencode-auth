import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCodeFetchPatch } from "../src/fetch-patch.ts";
import { CLI_USER_AGENT } from "../src/spoof.ts";

const CHAT_URL = "https://opencode.ai/inference/v1/chat/completions";
const SESSION_ID = "ses_test";
const sent: Array<{ headers: Record<string, string>; body: any }> = [];
let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    return new Response("ok");
  }) as typeof fetch;
  installOpenCodeFetchPatch(() => SESSION_ID);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const post = async (url: string, headers: Record<string, string>, body: unknown) => {
  sent.length = 0;
  await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return sent[0]!;
};

const toolNames = (body: any): string[] => (body.tools ?? []).map((tool: any) => tool.function.name);
const freeRequest = { model: "deepseek-v4.1-flash-free", messages: [] };

describe("OpenCode fetch patch", () => {
  test("stamps the CLI identity on an unstamped request", async () => {
    const { headers } = await post(CHAT_URL, {}, freeRequest);
    expect(headers["user-agent"]).toBe(CLI_USER_AGENT);
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers["x-opencode-session"]).toBe(SESSION_ID);
  });

  test("leaves an already-stamped request's identity alone", async () => {
    const { headers } = await post(CHAT_URL, { "x-opencode-client": "cli", "user-agent": "custom/1" }, freeRequest);
    expect(headers["user-agent"]).toBe("custom/1");
  });

  test("adds the `read` fingerprint to a free-lane request without tools", async () => {
    expect(toolNames((await post(CHAT_URL, {}, freeRequest)).body)).toEqual(["read"]);
  });

  test("adds `read` even when the request is already stamped", async () => {
    expect(toolNames((await post(CHAT_URL, { "x-opencode-client": "cli" }, freeRequest)).body)).toEqual(["read"]);
  });

  test("keeps the caller's tools and does not duplicate `read`", async () => {
    const read = { type: "function", function: { name: "read", parameters: {} } };
    expect(toolNames((await post(CHAT_URL, {}, { ...freeRequest, tools: [read] })).body)).toEqual(["read"]);
  });

  test("leaves paid lanes and other hosts alone", async () => {
    expect(toolNames((await post(CHAT_URL, {}, { model: "muse-spark-1.3-contributor", messages: [] })).body)).toEqual([]);
    const foreign = await post("https://api.openai.com/v1/chat/completions", {}, freeRequest);
    expect(foreign.headers["user-agent"]).toBeUndefined();
    expect(toolNames(foreign.body)).toEqual([]);
  });
});
