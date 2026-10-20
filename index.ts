import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installOpenCodeFetchPatch } from "./src/fetch-patch.ts";
import { createSessionId } from "./src/identifier.ts";
import {
  ANONYMOUS_API_KEY,
  spoofOpenCodeHeaders,
  ZEN_GO_PROVIDER,
  ZEN_PROVIDER,
} from "./src/spoof.ts";

/**
 * Patches Pi's built-in `opencode` (Zen) and `opencode-go` providers so their
 * requests look like they come from the OpenCode CLI. Zen's free tier only
 * serves requests that carry the CLI's identity, and its free models are
 * reachable without an account through the anonymous `public` bearer.
 */
export default function opencodeAuth(pi: ExtensionAPI): void {
  let sessionId = createSessionId();

  // Covers requests that never reach `before_provider_headers` (summarization
  // via `modelRegistry.complete`), which otherwise lose the CLI identity and
  // are refused by Zen's free tier.
  installOpenCodeFetchPatch(() => sessionId);

  pi.on("session_start", async (_event, ctx) => {
    sessionId = createSessionId();

    // A configured Zen credential owns the request: registered keys and stored
    // credentials take precedence over the extension key, and the keyed lane is
    // the only one that can reach Zen's paid models.
    const credential =
      (await ctx.modelRegistry.getApiKeyForProvider(ZEN_PROVIDER)) ??
      (await ctx.modelRegistry.getApiKeyForProvider(ZEN_GO_PROVIDER));
    if (credential) return;

    // Without a credential the provider has no auth method at all, so its
    // models stay hidden; the anonymous bearer makes them usable.
    pi.registerProvider(ZEN_PROVIDER, { apiKey: ANONYMOUS_API_KEY });
  });

  pi.on("before_provider_headers", (event) => {
    spoofOpenCodeHeaders(event.headers, sessionId);
  });
}
