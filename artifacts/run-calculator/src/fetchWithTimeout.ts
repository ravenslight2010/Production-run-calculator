// Timeout-aware fetch for the import-preparation chains (spec/premix/cheese).
//
// Why: the published app runs on autoscale and can be asleep when the user
// starts their SECOND import of a session (the tab idles between imports, the
// deployment scales to zero, and the next fetch can hang at the platform edge
// while the instance cold-starts). Without a timeout that hang leaves the
// import dialog's full-screen loading backdrop up forever — "the review window
// never appears and the buttons stop working". A bounded wait turns that hang
// into a clear, retryable error instead.
//
// AbortSignal.timeout() rejects with a DOMException named "TimeoutError"; some
// engines surface plain "AbortError". Both are mapped to a plain-language
// message that tells the user what actually happened and what to do.

import { fetchWithDiagnostics } from "./performanceDiagnostics";

export const IMPORT_WAKE_HINT =
  "The server didn't respond in time. If the app sat idle for a while it may just be waking up — wait a moment and try the import again.";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchWithDiagnostics(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // Match by name, not `instanceof DOMException` — abort reasons can come
    // from a different realm (worker, test env, some engines) where instanceof
    // fails even though the error IS a timeout/abort.
    const name = (err as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(IMPORT_WAKE_HINT);
    }
    throw err;
  }
}
