import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary, {
  isMissingNotificationError,
  isStaleDeploymentAssetError,
} from "./ErrorBoundary";
import { reportIncident } from "../inventoryShared";
import { updateAndReload } from "../pwaUpdateRecovery";
import { reportAutomaticUpdateReloadSafety } from "../updateReloadSafety";
import { checkPreHomeReloadSafety } from "../pwaStartupSafety";

vi.mock("../inventoryShared", () => ({
  reportIncident: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../pwaStartupSafety", () => ({
  checkPreHomeReloadSafety: vi.fn().mockResolvedValue(true),
}));

function ThrowError({ error }: { error: Error }): never {
  throw error;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  reportAutomaticUpdateReloadSafety(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isMissingNotificationError", () => {
  it("recognizes only Safari's known missing Notification reference error", () => {
    expect(isMissingNotificationError(new Error("Can't find variable: Notification"))).toBe(true);
    expect(isMissingNotificationError(new Error(" Can't  find variable: Notification "))).toBe(true);
    expect(isMissingNotificationError(new Error("Can't find variable: NotificationSettings"))).toBe(false);
    expect(isMissingNotificationError(new Error("Notification is not defined"))).toBe(false);
    expect(isMissingNotificationError(new Error("Can't find variable: window"))).toBe(false);
  });
});

describe("isStaleDeploymentAssetError", () => {
  it("recognizes dynamic import, HTML module MIME, and missing hashed chunk failures", () => {
    expect(isStaleDeploymentAssetError(new TypeError(
      "Failed to fetch dynamically imported module: https://app.test/assets/home-Ab12_cd3.js",
    ))).toBe(true);
    expect(isStaleDeploymentAssetError(new TypeError(
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    ))).toBe(true);
    expect(isStaleDeploymentAssetError(new Error(
      "GET /assets/home-Ab12_cd3.js net::ERR_ABORTED 404 (Not Found)",
    ))).toBe(true);
  });

  it("does not classify ordinary application or unrelated network failures", () => {
    expect(isStaleDeploymentAssetError(new Error("Failed to load a recipe"))).toBe(false);
    expect(isStaleDeploymentAssetError(new Error("GET /api/sync 404 (Not Found)"))).toBe(false);
    expect(isStaleDeploymentAssetError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("ErrorBoundary recovery actions", () => {
  it("shows the safe reference returned for an auto-captured failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(reportIncident).mockResolvedValueOnce({
      incidentId: "incident-1",
      correlationId: "corr-visible-1",
      diagnosis: null,
      workaround: null,
      recurrence: null,
      aiGenerated: false,
    });

    render(
      <ErrorBoundary>
        <ThrowError error={new Error("Failed to render")} />
      </ErrorBoundary>,
    );

    expect(await screen.findByText("corr-visible-1")).not.toBeNull();
  });

  it("offers the explicit update action and only runs it after staff choose it", async () => {
    const user = userEvent.setup();
    const updateAndReload = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onUpdateAndReload={updateAndReload}>
        <ThrowError error={new Error("Can't find variable: Notification")} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Update and reload" })).not.toBeNull();
    expect(screen.getByRole("main")).not.toBeNull();
    expect(updateAndReload).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Update and reload" }));

    expect(updateAndReload).toHaveBeenCalledOnce();
  });

  it("offers stale chunks one guarded update attempt and reports bounded build diagnostics", async () => {
    const user = userEvent.setup();
    const updateAndReload = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    const error = new TypeError(
      'Failed to load module script: Expected JavaScript but received MIME type "text/html".',
    );
    error.stack = "x".repeat(8_000);

    render(
      <ErrorBoundary onUpdateAndReload={updateAndReload}>
        <ThrowError error={error} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Update and reload" }));
    await user.click(screen.getByRole("button", { name: "Update and reload" }));

    expect(updateAndReload).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    const attempt = JSON.parse(sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1") ?? "null");
    expect(attempt).toMatchObject({
      fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/),
      attemptedAt: expect.any(Number),
    });
    expect(JSON.stringify(attempt)).not.toMatch(/https|stack|user|device/i);
    expect(vi.mocked(reportIncident)).toHaveBeenCalledWith(expect.objectContaining({
      appVersion: expect.any(String),
      errorMessage: expect.stringContaining("[stale_deployment_asset]"),
      errorStack: expect.stringMatching(/^x{4000}$/),
    }));
  });

  it.each(["cache-key reads", "cache deletion"] as const)(
    "continues the worker-update reload fallback when %s fail",
    async (failingOperation) => {
      const user = userEvent.setup();
      const keys = vi.fn().mockImplementation(async () => {
        if (failingOperation === "cache-key reads") throw new Error("cache keys unavailable");
        return ["workbox-precache-v2-http://app.test/", "google-fonts-cache"];
      });
      const remove = vi.fn().mockImplementation(async () => {
        if (failingOperation === "cache deletion") throw new Error("cache deletion unavailable");
        return true;
      });
      vi.stubGlobal("caches", { keys, delete: remove });
      const reload = vi.fn();
      vi.spyOn(console, "error").mockImplementation(() => {});
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, reload },
      });
      const registration = {
        waiting: undefined as ServiceWorker | undefined,
        update: vi.fn().mockRejectedValue(new Error("worker unavailable")),
      };
      const onUpdateAndReload = (canReload?: () => boolean) =>
        updateAndReload(registration, undefined, reload, canReload);

      render(
        <ErrorBoundary onUpdateAndReload={onUpdateAndReload}>
          <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
        </ErrorBoundary>,
      );

      await user.click(screen.getByRole("button", { name: "Update and reload" }));
      await waitFor(() => expect(reload).toHaveBeenCalledOnce());

      expect(keys).toHaveBeenCalledOnce();
      if (failingOperation === "cache-key reads") {
        expect(remove).not.toHaveBeenCalled();
      } else {
        expect(remove).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith("workbox-precache-v2-http://app.test/");
        expect(remove).not.toHaveBeenCalledWith("google-fonts-cache");
      }
      expect(registration.update).toHaveBeenCalledOnce();
    },
  );

  it("continues worker-update recovery and reload when CacheStorage is unavailable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("caches", undefined);
    const reload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    const registration = {
      waiting: undefined as ServiceWorker | undefined,
      update: vi.fn().mockRejectedValue(new Error("worker unavailable")),
    };
    const onUpdateAndReload = (canReload?: () => boolean) =>
      updateAndReload(registration, undefined, reload, canReload);

    render(
      <ErrorBoundary onUpdateAndReload={onUpdateAndReload}>
        <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Update and reload" }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(registration.update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("schedules one stale-chunk recovery only when the captured app state is safe", async () => {
    const updateAndReload = vi.fn().mockResolvedValue(undefined);
    let recoverWhenSafe: ((canReload: () => boolean) => void | Promise<void>) | undefined;
    const scheduleSafeIdleRecovery = vi.fn((safeAtFailure, recover) => {
      expect(safeAtFailure).toBe(true);
      recoverWhenSafe = recover;
      return vi.fn();
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportAutomaticUpdateReloadSafety(true);

    render(
      <ErrorBoundary
        onUpdateAndReload={updateAndReload}
        scheduleSafeIdleRecovery={scheduleSafeIdleRecovery}
      >
        <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
      </ErrorBoundary>,
    );

    expect(scheduleSafeIdleRecovery).toHaveBeenCalledOnce();
    expect(updateAndReload).not.toHaveBeenCalled();
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(true);
    await recoverWhenSafe?.(() => false);
    expect(updateAndReload).not.toHaveBeenCalled();
    await recoverWhenSafe?.(() => true);
    expect(updateAndReload).toHaveBeenCalledOnce();
    expect(updateAndReload).toHaveBeenCalledWith(expect.any(Function));
  });

  it("blocks stale-chunk recovery when the fresh pre-Home safety check is unsafe", async () => {
    const updateAndReload = vi.fn().mockResolvedValue(undefined);
    let recoverWhenSafe: ((canReload: () => boolean) => void | Promise<void>) | undefined;
    const scheduleSafeIdleRecovery = vi.fn((_safeAtFailure, recover) => {
      recoverWhenSafe = recover;
      return vi.fn();
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(checkPreHomeReloadSafety).mockResolvedValue(false);
    reportAutomaticUpdateReloadSafety(true);

    render(
      <ErrorBoundary
        onUpdateAndReload={updateAndReload}
        scheduleSafeIdleRecovery={scheduleSafeIdleRecovery}
      >
        <ThrowError error={new TypeError("Failed to fetch dynamically imported module")} />
      </ErrorBoundary>,
    );

    await recoverWhenSafe?.(() => true);
    expect(updateAndReload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("run-calc:stale-asset-recovery-pending:v1")).toBeNull();
    expect(await screen.findByText(
      /automatic recovery is paused because the app could not confirm that reloading was safe/i,
    )).not.toBeNull();
  });

  it("keeps the ordinary reload experience for unrelated errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onUpdateAndReload={vi.fn()}>
        <ThrowError error={new Error("Failed to load a recipe")} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Reload the app" })).not.toBeNull();
    expect(screen.getByRole("main")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Update and reload" })).toBeNull();
    expect(
      screen.getByText(/Reloading usually clears it — your saved work isn't affected\./),
    ).not.toBeNull();
  });
});