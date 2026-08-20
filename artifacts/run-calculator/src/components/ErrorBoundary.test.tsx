import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary, { isMissingNotificationError } from "./ErrorBoundary";

vi.mock("../inventoryShared", () => ({
  reportIncident: vi.fn().mockResolvedValue(undefined),
}));

function ThrowError({ error }: { error: Error }): never {
  throw error;
}

afterEach(() => {
  cleanup();
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
    expect(updateAndReload).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Update and reload" }));

    expect(updateAndReload).toHaveBeenCalledOnce();
  });

  it("keeps the ordinary reload experience for unrelated errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary onUpdateAndReload={vi.fn()}>
        <ThrowError error={new Error("Failed to load a recipe")} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("button", { name: "Reload the app" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Update and reload" })).toBeNull();
    expect(
      screen.getByText(/Reloading usually clears it — your saved work isn't affected\./),
    ).not.toBeNull();
  });
});