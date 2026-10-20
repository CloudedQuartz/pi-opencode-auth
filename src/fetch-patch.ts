import { createRequestId } from "./identifier.ts";
import { CLI_PROJECT_ID, CLI_USER_AGENT } from "./spoof.ts";

const INSTALLED = Symbol.for("pi-opencode-auth.fetch-patch");

/**
 * Zen's free tier refuses a body with no tool named `read`; the name is the
 * only thing inspected. Naked on purpose — with no parameters it cannot be
 * called, so a summarizer never trips over it.
 */
const READ_TOOL = {
  type: "function",
  function: { name: "read" },
};

/**
 * `modelRegistry.complete` — stock summarization and extension summarizers —
 * builds its request without provider attribution, so `before_provider_headers`
 * never fires for it. Unstamped and toolless, it is refused with
 * `403 FreeTierError`. Patching the transport all callers share covers them.
 */
export function installOpenCodeFetchPatch(getSessionId: () => string): void {
  const scope = globalThis as unknown as Record<symbol, unknown>;
  if (scope[INSTALLED]) return;
  const original = globalThis.fetch;
  scope[INSTALLED] = true;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url: string = typeof input === "string" ? input : (input?.url ?? "");
    if (!url.startsWith("https://opencode.ai/")) return original(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    if (headers.get("x-opencode-client") !== "cli") {
      headers.set("User-Agent", CLI_USER_AGENT);
      headers.set("x-opencode-client", "cli");
      headers.set("x-opencode-project", CLI_PROJECT_ID);
      headers.set("x-opencode-session", getSessionId());
      headers.set("x-opencode-request", createRequestId());
    }

    let body = init?.body;
    try {
      const parsed = JSON.parse(body as string);
      const model = String(parsed.model ?? "");
      const freeLane = model.endsWith("-free") || model === "big-pickle";
      if (freeLane && !parsed.tools?.some((tool: any) => tool.function?.name === "read")) {
        body = JSON.stringify({ ...parsed, tools: [...(parsed.tools ?? []), READ_TOOL] });
      }
    } catch {
      // Not a JSON body: nothing to fingerprint-fix.
    }

    return original(input, { ...init, headers, body });
  }) as typeof fetch;
}
