import { WEB_BUILD_ID } from "./buildIdentity";

export type UpdatePhase = "unchecked" | "checking" | "current" | "ready" | "updating" | "blocked" | "offline" | "failed" | "confirmed";
export type UpdateState = { phase: UpdatePhase; running: string; target?: string; stage?: string };
const ATTEMPT_KEY = "run-calc:pwa-update-attempt:v1";
export const UPDATE_STAGE_TIMEOUT_MS = 15_000;
const validBuild = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value) && value !== "local";

export function bounded<T>(operation: Promise<T>, stage: string, ms = UPDATE_STAGE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(stage)), ms);
    operation.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(new Error(stage)); });
  });
}

export function confirmUpdateStartup(running: string): UpdatePhase | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(ATTEMPT_KEY);
    const attempt = JSON.parse(raw);
    return validBuild(attempt.target) && attempt.target === running
      && Number.isFinite(attempt.at) && Date.now() - attempt.at >= 0
      && Date.now() - attempt.at < 30 * 60_000 ? "confirmed" : "failed";
  } catch { return "failed"; }
}

/** Only release metadata is fetched; it is never stored in business stores. */
export async function fetchPublishedBuild(): Promise<string> {
  const controller = new AbortController();
  try {
    const response = await bounded(fetch(
      `${import.meta.env.BASE_URL}app-build.json?check=${Date.now()}`,
      { cache: "no-store", credentials: "same-origin", signal: controller.signal },
    ), "identity");
    if (!response.ok) throw new Error("identity");
    const body = await bounded(response.json(), "identity");
    if (!validBuild(body.buildId)) throw new Error("identity");
    return body.buildId;
  } finally { controller.abort(); }
}

/** Wait for activation, not update() resolution or installation. Never claim tabs. */
export async function prepareUpdatedWorker(registration: ServiceWorkerRegistration): Promise<void> {
  // Do not wait on a hung discovery if an installed update already exists.
  if (!registration.waiting && !registration.installing) {
    await bounded(registration.update(), "discovery");
  }
  const worker = registration.waiting ?? registration.installing;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener("statechange", inspect); };
    const inspect = () => {
      if (worker.state === "activated") { cleanup(); resolve(); }
      else if (worker.state === "redundant") { cleanup(); reject(new Error("installation")); }
      else if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("activation")); }, UPDATE_STAGE_TIMEOUT_MS);
    worker.addEventListener("statechange", inspect);
    // Supports prompt-mode waiting workers as well as the authored skipWaiting worker.
    inspect();
  });
}

export function createUpdateCoordinator(options: {
  registration: () => ServiceWorkerRegistration | undefined;
  safe: () => boolean;
  reload: () => void;
  changed: (state: UpdateState) => void;
  identity?: () => Promise<string>;
  running?: string;
}) {
  const running = options.running ?? WEB_BUILD_ID;
  let state: UpdateState = { running, phase: "unchecked" };
  let started = false;
  let busy = false;
  const publish = (phase: UpdatePhase, stage?: string) => {
    state = { ...state, phase, stage };
    try {
      const raw = JSON.parse(sessionStorage.getItem("run-calc:pwa-update-diagnostics:v1") ?? "[]");
      const events = Array.isArray(raw) ? raw.slice(-11) : [];
      // Allowlisted state only: never error messages, URLs or operational data.
      events.push({ at: Date.now(), phase, stage, running, target: state.target });
      sessionStorage.setItem("run-calc:pwa-update-diagnostics:v1", JSON.stringify(events));
    } catch { /* Diagnostics must not be a prerequisite for keeping work usable. */ }
    options.changed(state);
  };
  const check = async () => {
    if (busy) return;
    busy = true;
    publish("checking");
    try {
      state = { ...state, target: await (options.identity ?? fetchPublishedBuild)() };
      publish(state.target === running ? "current" : "ready");
    } catch { publish(navigator.onLine === false ? "offline" : "failed", "identity"); }
    finally { busy = false; }
  };
  const update = async (
    guard: () => boolean = options.safe,
    verifyBeforeReload?: () => Promise<boolean>,
  ) => {
    if (busy) return;
    if (!guard()) { publish("blocked", "safety"); return; }
    if (!state.target || state.target === running || ["failed", "offline"].includes(state.phase)) await check();
    const recoveringCurrent = Boolean(verifyBeforeReload && state.target === running && state.phase === "current");
    if (!state.target || (!recoveringCurrent && (state.target === running || !["ready", "blocked"].includes(state.phase)))) return;
    if (!guard()) { publish("blocked", "safety"); return; }
    busy = true;
    let navigating = false;
    publish("updating", "activation");
    try {
      const registration = options.registration() ??
        (typeof navigator.serviceWorker === "undefined" ? undefined :
          await bounded(navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL), "discovery"));
      if (registration) await prepareUpdatedWorker(registration);
      // A second fresh check fences a release changing during installation.
      const target = await (options.identity ?? fetchPublishedBuild)();
      if (target !== state.target) throw new Error("identity-changed");
      if (verifyBeforeReload && !await bounded(verifyBeforeReload(), "safety")) {
        publish("blocked", "safety");
        return;
      }
      if (!guard()) { publish("blocked", "safety"); return; }
      // If storage is unavailable, still allow explicit recovery, but never
      // report it as confirmed on the next document.
      try {
        if (!recoveringCurrent) sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ target, at: Date.now() }));
      }
      catch { /* Confirmation remains unavailable, not successful. */ }
      options.reload();
      navigating = true;
      // Remain "updating" until this document disappears. Navigation being
      // requested is not a failure or a success. If the browser cancels it,
      // expose a bounded, retryable startup failure instead of hanging.
      setTimeout(() => { busy = false; publish("failed", "startup"); }, UPDATE_STAGE_TIMEOUT_MS);
    } catch (error) {
      const stage = error instanceof Error && ["discovery", "activation", "installation", "identity", "identity-changed", "safety"].includes(error.message)
        ? error.message : "handoff";
      publish(navigator.onLine === false ? "offline" : "failed", stage);
    } finally { busy = navigating; }
  };
  const start = () => {
    if (!started) {
      started = true;
      publish(confirmUpdateStartup(running) ?? "unchecked", "startup");
    }
    return state;
  };
  return { start, check, update, snapshot: () => state };
}
