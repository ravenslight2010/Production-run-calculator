/**
 * The evaluator is a same-host service, not a general HTTP proxy. Pin localhost
 * to a numeric loopback address so DNS/hosts-file changes cannot widen access.
 * Redirects must also be disabled by the caller.
 */
export function importGoldEndpoint(base: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(base);
  } catch {
    throw new Error("provider_unavailable");
  }
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash
  ) {
    throw new Error("provider_unavailable");
  }
  if (endpoint.hostname === "localhost") endpoint.hostname = "127.0.0.1";
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}/chat/completions`;
  return endpoint;
}

export function fetchImportGoldLocal(base: string, init: RequestInit): Promise<Response> {
  return fetch(importGoldEndpoint(base), { ...init, redirect: "error" });
}

/** Configuration validity only; deliberately not a live availability probe. */
export function isImportGoldLocalConfigured(env = process.env): boolean {
  if (env.IMPORT_GOLD_LOCAL_ENABLED !== "true" && !env.IMPORT_GOLD_LOCAL_BASE_URL) return false;
  try {
    importGoldEndpoint(env.IMPORT_GOLD_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1");
    return true;
  } catch {
    return false;
  }
}
