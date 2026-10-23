const epochs = new Map<string, string>();
let generation = 0;
const roots = new Set([
  "ingredients", "mixes", "cheese-recipes", "dough-recipes", "sauce-recipes", "brand-profiles",
  "run-templates", "factory-data", "die-types", "merged-away", "spec-import-aliases", "merge-aliases", "ingredient-batch-weights",
]);
function pathFor(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const origin = typeof window === "undefined" ? "http://workspace.invalid" : window.location.origin;
    const url = new URL(raw, origin);
    return url.origin === origin ? url.pathname : null;
  } catch { return null; }
}
function familyFor(path: string | null): string | null {
  const match = path?.match(/^\/api\/([^/]+)(?:\/|$)/u);
  return match && roots.has(match[1]!) ? match[1]! : null;
}
export function resetMasterDataEpochs(): void { generation++; epochs.clear(); }
export function masterDataEpoch(resource: string): string {
  return epochs.get(resource.replace(/^\/api\//u, "").split("/")[0]!) ?? "unbound";
}
export function masterDataEpochHeaders(resource: string, originalEpoch = masterDataEpoch(resource)): Record<string, string> {
  return { "x-master-data-epoch": originalEpoch };
}
export function prepareMasterDataEpochRequest(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const family = familyFor(pathFor(input));
  if (!family || !["POST", "PUT", "PATCH", "DELETE"].includes(method)) return init;
  const headers = new Headers(init?.headers ?? request?.headers);
  // Queued work carries its ORIGINAL epoch, never a fresh read's epoch.
  if (!headers.has("x-master-data-epoch")) headers.set("x-master-data-epoch", masterDataEpoch(family));
  return { ...init, headers };
}
export function masterDataEpochReadReceipt(input: RequestInfo | URL, init?: RequestInit): (response: Response) => void {
  const epochGeneration = generation;
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const path = pathFor(input);
  return (response) => {
    if (epochGeneration !== generation || method !== "GET" || !(response.ok || response.status === 304)) return;
    const value = response.headers?.get("x-master-data-epoch");
    if (!value || !/^(?:0|[1-9]\d{0,14})$/u.test(value)) return;
    const family = familyFor(path);
    if (path === "/api/master-data/bootstrap") {
      for (const key of ["ingredients", "mixes", "cheese-recipes", "dough-recipes", "sauce-recipes"]) epochs.set(key, value);
    } else if (family && (path === `/api/${family}` || path === "/api/factory-data/operational")) epochs.set(family, value);
  };
}
