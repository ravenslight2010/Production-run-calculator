import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary, { isMissingNotificationError, isStaleDeploymentAssetError } from "./ErrorBoundary";
import { reportIncident } from "../inventoryShared";
import { reportAutomaticUpdateReloadSafety } from "../updateReloadSafety";
import { checkPreHomeReloadSafety } from "../pwaStartupSafety";

vi.mock("../inventoryShared", () => ({ reportIncident: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../pwaStartupSafety", () => ({ checkPreHomeReloadSafety: vi.fn().mockResolvedValue(true) }));
function ThrowError({ error }: { error: Error }): never { throw error; }
afterEach(() => {
  cleanup(); sessionStorage.clear(); reportAutomaticUpdateReloadSafety(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("recovery error classification", () => {
  it("keeps the exact Safari Notification match", () => {
    for (const text of ["Can't find variable: Notification", " Can't  find variable: Notification "]) {
      expect(isMissingNotificationError(new Error(text))).toBe(true);
    }
    for (const text of ["Can't find variable: NotificationSettings", "Notification is not defined", "Can't find variable: window"]) {
      expect(isMissingNotificationError(new Error(text))).toBe(false);
    }
  });
  it("recognizes only stale chunk and HTML module failures", () => {
    for (const text of [
      "Failed to fetch dynamically imported module: https://app.test/assets/home-Ab12_cd3.js",
      'Failed to load module script: Expected JavaScript but received MIME type "text/html".',
      "GET /assets/home-Ab12_cd3.js net::ERR_ABORTED 404 (Not Found)",
    ]) expect(isStaleDeploymentAssetError(new TypeError(text))).toBe(true);
    for (const text of ["Failed to load a recipe", "GET /api/sync 404 (Not Found)"]) {
      expect(isStaleDeploymentAssetError(new Error(text))).toBe(false);
    }
    expect(isStaleDeploymentAssetError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("ErrorBoundary guarded recovery", () => {
  it("shows the safe diagnostic reference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(reportIncident).mockResolvedValueOnce({
      incidentId: "fixture", correlationId: "corr-visible", diagnosis: null,
      workaround: null, recurrence: null, aiGenerated: false,
    });
    render(<ErrorBoundary><ThrowError error={new Error("Failed to render")} /></ErrorBoundary>);
    expect(await screen.findByText("corr-visible")).not.toBeNull();
  });
  it.each([true, false])("keeps explicit update gated by captured and fresh safety (%s)", async safe => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(safe);
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ErrorBoundary onUpdateAndReload={update}>
      <ThrowError error={new Error("Can't find variable: Notification")} />
    </ErrorBoundary>);
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]()).toBe(safe);
  });
  it("does not erase caches, business storage, or force a reload when a manual update stalls", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(true);
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(true);
    const remove = vi.fn();
    const keys = vi.fn();
    vi.stubGlobal("caches", { keys, delete: remove });
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    localStorage.setItem("fixture-pending-work", "retained");
    const update = vi.fn(() => new Promise<void>(() => {}));
    render(<ErrorBoundary onUpdateAndReload={update}>
      <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
    </ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    expect(keys).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(localStorage.getItem("fixture-pending-work")).toBe("retained");
    localStorage.removeItem("fixture-pending-work");
  });
  it("retains bounded stale-recovery evidence and allows explicit retries without unconditional reloads", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(true);
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue(undefined);
    const error = new TypeError("Failed to fetch dynamically imported module: https://fixture.test/assets/diagnostics-abc123.js");
    error.stack = "x".repeat(8000);
    render(<ErrorBoundary onUpdateAndReload={update}><ThrowError error={error} /></ErrorBoundary>);
    await userEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    await userEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    expect(update).toHaveBeenCalledTimes(2);
    const raw = sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1")!;
    expect(JSON.parse(raw)).toEqual({ fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/), attemptedAt: expect.any(Number) });
    expect(raw).not.toMatch(/https|stack|user|device/i);
    expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      appVersion: expect.any(String), errorMessage: expect.stringContaining("[stale_deployment_asset]"),
      errorStack: expect.stringMatching(/^x{4000}$/),
    }));
  });
  it("schedules one automatic attempt, rechecks safety, and respects the live idle guard", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(true);
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(true);
    let recover: ((guard: () => boolean) => void | Promise<void>) | undefined;
    const schedule = vi.fn((safe, action) => { expect(safe).toBe(true); recover = action; return vi.fn(); });
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ErrorBoundary onUpdateAndReload={update} scheduleSafeIdleRecovery={schedule}>
      <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
    </ErrorBoundary>);
    expect(schedule).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    await recover?.(() => false);
    expect(update).not.toHaveBeenCalled();
    await recover?.(() => true);
    await recover?.(() => true);
    expect(update).toHaveBeenCalledOnce();
  });
  it("blocks automatic and explicit navigation when the fresh proof is unsafe", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(true);
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(false);
    let recover: ((guard: () => boolean) => void | Promise<void>) | undefined;
    const schedule = vi.fn((_safe, action) => { recover = action; return vi.fn(); });
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ErrorBoundary onUpdateAndReload={update} scheduleSafeIdleRecovery={schedule}>
      <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
    </ErrorBoundary>);
    await recover?.(() => true);
    expect(update).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1")).toBeNull();
    await waitFor(() => expect(screen.getByText(/Automatic recovery is paused/)).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Update and reload" }));
    expect(update.mock.calls[0][0]()).toBe(false);
  });
  it("keeps unrelated failures out of update recovery", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary onUpdateAndReload={vi.fn()}><ThrowError error={new Error("Failed to load a recipe")} /></ErrorBoundary>);
    expect(screen.getByRole("button", { name: "Reload the app" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Update and reload" })).toBeNull();
  });
});
