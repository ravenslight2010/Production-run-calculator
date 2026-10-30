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

export function importGoldHealthEndpoint(base: string): URL {
  const endpoint = importGoldEndpoint(base);
  endpoint.pathname = "/healthz";
  return endpoint;
}

export function fetchImportGoldLocal(base: string, init: RequestInit): Promise<Response> {
  return fetch(importGoldEndpoint(base), { ...init, redirect: "error" });
}

export function isImportGoldDevelopmentRuntime(env = process.env): boolean {
  const deploymentId = env.REPLIT_DEPLOYMENT_ID?.trim();
  const deploymentMarker = env.REPLIT_DEPLOYMENT?.trim().toLowerCase();
  return env.NODE_ENV !== "production"
    && !deploymentId
    && deploymentMarker !== "1"
    && deploymentMarker !== "true";
}

export async function isImportGoldLocalAvailable(
  base: string,
  expectedModel = "qwen3.5-9b-q3_k_m",
): Promise<boolean> {
  try {
    const response = await fetch(importGoldHealthEndpoint(base), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(700),
    });
    if (!response.ok) return false;
    const health = await response.json() as Record<string, unknown>;
    return health.status === "healthy"
      && health.model === expectedModel
      && health.contextLimit === 4096;
  } catch {
    return false;
  }
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
