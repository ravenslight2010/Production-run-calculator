import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary, {
  isMissingNotificationError,
  isStaleDeploymentAssetError,
} from "./ErrorBoundary";
import { reportIncident } from "../inventoryShared";

vi.mock("../inventoryShared", () => ({
  reportIncident: vi.fn().mockResolvedValue(undefined),
}));

function ThrowError({ error }: { error: Error }): never {
  throw error;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
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
    expect(vi.mocked(reportIncident)).toHaveBeenCalledWith(expect.objectContaining({
      appVersion: expect.any(String),
      errorMessage: expect.stringContaining("[stale_deployment_asset]"),
      errorStack: expect.stringMatching(/^x{4000}$/),
    }));
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