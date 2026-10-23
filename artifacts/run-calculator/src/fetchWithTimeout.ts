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
  "The server didn't respond before the client timeout. If you were saving data, check whether it was saved before trying again. If the app sat idle, it may have been waking up.";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetchAndConsumeWithTimeout(url, init, timeoutMs, async (response) => response);
}

/** Keep the same deadline and caller cancellation through response-body reads. */
export async function fetchAndConsumeWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;
  const abort = () => timeoutController.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);
  let removeAbortListener = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      const rejectAbort = () => reject(timeoutController.signal.reason ?? new DOMException("Request cancelled", "AbortError"));
      removeAbortListener = () => timeoutController.signal.removeEventListener("abort", rejectAbort);
      if (timeoutController.signal.aborted) rejectAbort();
      else timeoutController.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const operation = (async () => {
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      const response = await fetchWithDiagnostics(url, { ...init, signal: timeoutController.signal });
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
      return consume(response, timeoutController.signal);
    })();
    return await Promise.race([operation, aborted]);
  } catch (err) {
    // Match by name, not `instanceof DOMException` — abort reasons can come
    // from a different realm (worker, test env, some engines) where instanceof
    // fails even though the error IS a timeout/abort.
    const name = (err as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || (name === "AbortError" && timedOut)) {
      if (callerSignal?.aborted) throw err;
      throw new Error(IMPORT_WAKE_HINT);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    removeAbortListener();
    callerSignal?.removeEventListener("abort", abort);
  }
}
