// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AlertSettingsDialog from "./AlertSettingsDialog";
import { fetchVapidPublicKey, getWebPushStatus, recoverWebPush } from "../webPush";

vi.mock("../webPush", () => ({
  disableWebPush: vi.fn(),
  enableWebPush: vi.fn(),
  fetchVapidPublicKey: vi.fn(),
  getWebPushStatus: vi.fn(),
  recoverWebPush: vi.fn(),
}));

const subscription = { endpoint: "https://push.example/saved" } as unknown as PushSubscription;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlertSettingsDialog Web Push recovery", () => {
  it("explains a rejected registration and waits for confirmation before replacing it", async () => {
    const user = userEvent.setup();
    const onTogglePref = vi.fn();
    const onToggleFloorMode = vi.fn();
    vi.mocked(getWebPushStatus).mockResolvedValue({
      state: "error",
      error: "Invalid push subscription",
      registrationRejected: true,
      subscription,
      subscriptionId: "saved-device-id",
      subscriptionWasExisting: true,
    });
    vi.mocked(fetchVapidPublicKey).mockResolvedValue("test-public-key");
    vi.mocked(recoverWebPush).mockResolvedValue({ state: "enabled", subscription });

    render(
      <AlertSettingsDialog
        open
        onOpenChange={vi.fn()}
        prefs={{}}
        onTogglePref={onTogglePref}
        floorModeEnabled={false}
        onToggleFloorMode={onToggleFloorMode}
      />,
    );

    expect(await screen.findByText(/server rejected this device’s saved notification subscription/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore this device" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Your account-level alert choices will stay unchanged.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(recoverWebPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Restore this device" }));
    await user.click(screen.getByRole("button", { name: "Replace subscription" }));
    await waitFor(() => {
      expect(recoverWebPush).toHaveBeenCalledWith("test-public-key", subscription, "saved-device-id", true);
    });
    expect(onTogglePref).not.toHaveBeenCalled();
    expect(onToggleFloorMode).not.toHaveBeenCalled();
  });

  it("restores the recovery option when the dialog is reopened", async () => {
    vi.mocked(getWebPushStatus)
      .mockResolvedValueOnce({ state: "enabled", subscription })
      .mockResolvedValueOnce({
        state: "error",
        error: "The server rejected this device’s saved notification subscription.",
        registrationRejected: true,
        subscription,
        subscriptionId: "saved-device-id",
        subscriptionWasExisting: true,
      });
    const props = {
      onOpenChange: vi.fn(),
      prefs: {},
      onTogglePref: vi.fn(),
      floorModeEnabled: false,
      onToggleFloorMode: vi.fn(),
    };
    const { rerender } = render(<AlertSettingsDialog {...props} open />);

    await waitFor(() => expect(getWebPushStatus).toHaveBeenCalledTimes(1));
    rerender(<AlertSettingsDialog {...props} open={false} />);
    rerender(<AlertSettingsDialog {...props} open />);

    expect(await screen.findByText(/server rejected this device’s saved notification subscription/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore this device" })).toBeTruthy();
    expect(getWebPushStatus).toHaveBeenCalledTimes(2);
  });
});
