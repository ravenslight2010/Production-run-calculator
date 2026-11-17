// @vitest-environment jsdom
//
// Browser notification delivery must be safe in WebViews that omit Notification
// entirely or expose only a partial global. These tests exercise the shared
// boundary used by both the hook's alert effects and sauce-tab notifications.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserNotificationCapability,
  requestBrowserNotificationPermission,
  showAppNotification,
} from "../useNotifications";

function installNotification(value: unknown): void {
  Object.defineProperty(window, "Notification", {
    value,
    writable: true,
    configurable: true,
  });
}

async function flushNotifications(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).Notification;
});

describe("browser Notification capability boundary", () => {
  it("treats an absent API as unavailable without throwing during shared delivery", async () => {
    // jsdom intentionally provides no Notification implementation.
    expect(getBrowserNotificationCapability()).toEqual({ state: "unavailable" });
    expect(() => {
      showAppNotification("Batch due", { body: "Start another batch." });
    }).not.toThrow();
    await flushNotifications();
  });

  it("treats a present-but-incomplete API as unavailable without interrupting delivery", async () => {
    // Function-shaped but missing the static permission field: a shape seen in
    // embedded browser implementations that cannot actually send alerts.
    const incomplete = vi.fn();
    installNotification(incomplete);

    expect(getBrowserNotificationCapability()).toEqual({ state: "unavailable" });
    expect(() => {
      showAppNotification("Batch due", { body: "Start another batch." });
      requestBrowserNotificationPermission();
    }).not.toThrow();
    await flushNotifications();
    expect(incomplete).not.toHaveBeenCalled();
  });

  it("reports denied, default, and granted states and requests permission only when supported", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const notification = Object.assign(vi.fn(), {
      permission: "default" as NotificationPermission,
      requestPermission,
    });
    installNotification(notification);

    expect(getBrowserNotificationCapability().state).toBe("default");
    const onGranted = vi.fn();
    requestBrowserNotificationPermission(onGranted);
    await flushNotifications();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(onGranted).toHaveBeenCalledOnce();

    notification.permission = "denied";
    expect(getBrowserNotificationCapability().state).toBe("denied");
    requestBrowserNotificationPermission(onGranted);
    expect(requestPermission).toHaveBeenCalledOnce();

    notification.permission = "granted";
    expect(getBrowserNotificationCapability().state).toBe("granted");
    showAppNotification("Run complete", { body: "End the run." });
    await flushNotifications();
    expect(notification).toHaveBeenCalledWith("Run complete", { body: "End the run." });
  });
});