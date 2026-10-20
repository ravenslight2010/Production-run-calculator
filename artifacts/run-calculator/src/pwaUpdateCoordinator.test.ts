import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmUpdateStartup, createUpdateCoordinator, prepareUpdatedWorker, UPDATE_STAGE_TIMEOUT_MS } from "./pwaUpdateCoordinator";
import { updateAndReload } from "./pwaUpdateRecovery";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); sessionStorage.clear(); });
function setup(extra = {}) {
  const reload = vi.fn();
  const changed = vi.fn();
  const coordinator = createUpdateCoordinator({
    running: "old-build", identity: vi.fn().mockResolvedValue("new-build"),
    registration: () => undefined, safe: () => true, reload, changed, ...extra,
  });
  return { ...coordinator, reload, changed };
}
describe("data-safe update coordinator", () => {
  it("reproduces the legacy stranded activation: resolved activation is not a navigation", async () => {
    const reload = vi.fn();
    await updateAndReload({
      update: vi.fn().mockResolvedValue(undefined), waiting: {} as ServiceWorker,
    }, vi.fn().mockResolvedValue(undefined), reload);
    expect(reload).not.toHaveBeenCalled();
  });
  it("does not call an unavailable identity current and supports retry", async () => {
    const identity = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue("old-build");
    const c = setup({ identity });
    await c.check();
    expect(c.snapshot()).toMatchObject({ phase: "failed", stage: "identity" });
    await c.check();
    expect(c.snapshot().phase).toBe("current");
  });
  it("requires the intended next-page identity before reporting completion", async () => {
    const c = setup();
    await c.update();
    expect(c.reload).toHaveBeenCalledOnce();
    expect(c.snapshot().phase).not.toBe("confirmed");
    expect(confirmUpdateStartup("old-build")).toBe("failed");
    const retry = setup();
    await retry.update();
    expect(confirmUpdateStartup("new-build")).toBe("confirmed");
    expect(confirmUpdateStartup("new-build")).toBeNull();
  });
  it("blocks explicit actions and rechecks safety after asynchronous work", async () => {
    let safe = false;
    const identity = vi.fn(async () => { safe = false; return "new-build"; });
    const c = setup({ safe: () => safe, identity });
    await c.update();
    expect(c.snapshot().phase).toBe("blocked");
    expect(identity).not.toHaveBeenCalled();
    safe = true;
    await c.update();
    expect(c.reload).not.toHaveBeenCalled();
    expect(c.snapshot().phase).toBe("blocked");
  });
  it("queues a manual update until work is safe, then performs the normal verified handoff", async () => {
    let safe = false;
    let notifySafetyChange: (() => void) | undefined;
    const c = setup({
      safe: () => safe,
      subscribeSafe: (notify: () => void) => {
        notifySafetyChange = notify;
        return () => { notifySafetyChange = undefined; };
      },
    });

    await c.check();
    await c.requestUpdate();
    expect(c.snapshot()).toMatchObject({ phase: "waiting", target: "new-build" });
    expect(c.reload).not.toHaveBeenCalled();

    safe = true;
    notifySafetyChange?.();
    await vi.waitFor(() => expect(c.reload).toHaveBeenCalledOnce());
    expect(c.snapshot().phase).toBe("updating");
    expect(confirmUpdateStartup("new-build")).toBe("confirmed");
  });
  it("lets the user cancel a queued update without changing the running page", async () => {
    let safe = false;
    const c = setup({
      safe: () => safe,
      subscribeSafe: () => () => undefined,
    });
    await c.check();
    await c.requestUpdate();

    c.cancelQueuedUpdate();

    expect(c.snapshot().phase).toBe("deferred");
    expect(c.reload).not.toHaveBeenCalled();
  });
  it("allows a deferred manual update to be explicitly resumed", async () => {
    let safe = false;
    const c = setup({
      safe: () => safe,
      subscribeSafe: () => () => undefined,
    });
    await c.check();
    await c.requestUpdate();
    c.cancelQueuedUpdate();
    safe = true;

    await c.requestUpdate();

    expect(c.reload).toHaveBeenCalledOnce();
    expect(c.snapshot().phase).toBe("updating");
  });
  it("does not report completion when startup is interrupted or the target changed", async () => {
    const c = setup({ identity: vi.fn().mockResolvedValueOnce("new-build").mockResolvedValue("newer-build") });
    await c.update();
    expect(c.reload).not.toHaveBeenCalled();
    expect(c.snapshot()).toMatchObject({ phase: "failed", stage: "identity-changed" });
  });
  it("does not use stale target metadata after a failed retry", async () => {
    const identity = vi.fn().mockResolvedValueOnce("new-build").mockRejectedValue(new Error());
    const c = setup({ identity });
    await c.check();
    await c.check();
    await c.update();
    expect(c.reload).not.toHaveBeenCalled();
  });
  it("waits for actual activation without relying on controlling, and times out retryably", async () => {
    vi.useFakeTimers();
    const worker = new EventTarget() as ServiceWorker;
    Object.defineProperty(worker, "state", { configurable: true, value: "installed" });
    worker.postMessage = vi.fn();
    const registration = { waiting: worker, update: vi.fn(() => new Promise(() => {})) } as unknown as ServiceWorkerRegistration;
    let done = false;
    const pending = prepareUpdatedWorker(registration).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    Object.defineProperty(worker, "state", { configurable: true, value: "activated" });
    worker.dispatchEvent(new Event("statechange"));
    await pending;
    expect(done).toBe(true);
    expect(registration.update).not.toHaveBeenCalled();
    Object.defineProperty(worker, "state", { configurable: true, value: "installing" });
    const stalled = prepareUpdatedWorker(registration);
    const assertion = expect(stalled).rejects.toThrow("activation");
    await vi.advanceTimersByTimeAsync(UPDATE_STAGE_TIMEOUT_MS);
    await assertion;
  });
  it("does not navigate if work starts while activation is pending", async () => {
    let safe = true;
    const worker = new EventTarget() as ServiceWorker;
    Object.defineProperty(worker, "state", { configurable: true, value: "installed" });
    worker.postMessage = vi.fn();
    const registration = { waiting: worker } as ServiceWorkerRegistration;
    const c = setup({ safe: () => safe, registration: () => registration });
    await c.check();
    const updating = c.update();
    safe = false;
    Object.defineProperty(worker, "state", { configurable: true, value: "activated" });
    worker.dispatchEvent(new Event("statechange"));
    await updating;
    expect(c.reload).not.toHaveBeenCalled();
    expect(c.snapshot().phase).toBe("blocked");
  });
  it("checks fresh recovery proof after activation and bounds interrupted navigation", async () => {
    const c = setup();
    await c.update(() => true, async () => false);
    expect(c.reload).not.toHaveBeenCalled();
    expect(c.snapshot().phase).toBe("blocked");
    await c.update(() => true, async () => true);
    expect(c.snapshot().phase).toBe("updating");
    await vi.advanceTimersByTimeAsync(UPDATE_STAGE_TIMEOUT_MS);
    expect(c.snapshot()).toMatchObject({ phase: "failed", stage: "startup" });
  });
  it("allows guarded same-build error recovery without calling it an update completion", async () => {
    const c = setup({ identity: async () => "old-build" });
    await c.update();
    expect(c.reload).not.toHaveBeenCalled();
    await c.update(() => true, async () => true);
    expect(c.reload).toHaveBeenCalledOnce();
    expect(confirmUpdateStartup("old-build")).toBeNull();
  });
});
