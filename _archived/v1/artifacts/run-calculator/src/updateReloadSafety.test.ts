import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAutomaticUpdateReloadSafety,
  hasAutomaticUpdateReloadBlockingSurface,
  isAutomaticUpdateReloadSafe,
  reportAutomaticUpdateReloadBlocker,
  reportAutomaticUpdateReloadSafety,
  scheduleSafeIdleAutomaticRecovery,
  startUpdateReloadIdleTracking,
  subscribeAutomaticUpdateReloadSafety,
  useAutomaticUpdateReloadBlocker,
} from "./updateReloadSafety";

describe("automatic update reload safety", () => {
  it("allows only a fully safe calculator state", () => {
    expect(isAutomaticUpdateReloadSafe({
      hasActiveRun: false,
      hasUnsavedForm: false,
      hasBlockingDialog: false,
      hasBlockingOperation: false,
      hasPendingSync: false,
      hasFailedSync: false,
    })).toBe(true);

    for (const unsafeField of [
      "hasActiveRun",
      "hasUnsavedForm",
      "hasBlockingDialog",
      "hasBlockingOperation",
      "hasPendingSync",
      "hasFailedSync",
    ] as const) {
      expect(isAutomaticUpdateReloadSafe({
        hasActiveRun: false,
        hasUnsavedForm: false,
        hasBlockingDialog: false,
        hasBlockingOperation: false,
        hasPendingSync: false,
        hasFailedSync: false,
        [unsafeField]: true,
      })).toBe(false);
    }
  });

  it.each([
    ["running work", { hasActiveRun: true }],
    ["paused work", { hasActiveRun: true }],
    ["dirty form", { hasUnsavedForm: true }],
    ["open dialog", { hasBlockingDialog: true }],
    ["active import", { hasBlockingOperation: true }],
    ["pending sync", { hasPendingSync: true }],
    ["failed sync", { hasFailedSync: true }],
  ])("blocks %s", (_label, unsafe) => {
    expect(isAutomaticUpdateReloadSafe({
      hasActiveRun: false,
      hasUnsavedForm: false,
      hasBlockingDialog: false,
      hasBlockingOperation: false,
      hasPendingSync: false,
      hasFailedSync: false,
      ...unsafe,
    })).toBe(false);
  });

  it("replays the current safety value to subscribers that mount later", () => {
    reportAutomaticUpdateReloadSafety(true);
    const notify = vi.fn();
    const unsubscribe = subscribeAutomaticUpdateReloadSafety(notify);

    expect(getAutomaticUpdateReloadSafety()).toBe(true);
    reportAutomaticUpdateReloadSafety(false);
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("treats every named blocking surface as unsafe", () => {
    expect(hasAutomaticUpdateReloadBlockingSurface({
      floorMode: false,
      ingredientDetail: true,
      productionDueAlert: false,
    })).toBe(true);
  });

  it("aggregates locally-owned dialogs with Home's reported safety", () => {
    reportAutomaticUpdateReloadSafety(true);
    reportAutomaticUpdateReloadBlocker("ingredient-detail", true);
    expect(getAutomaticUpdateReloadSafety()).toBe(false);

    reportAutomaticUpdateReloadBlocker("ingredient-detail", false);
    expect(getAutomaticUpdateReloadSafety()).toBe(true);
    reportAutomaticUpdateReloadSafety(false);
  });

  it("keeps an open Ingredient Detail dialog blocked until it closes", () => {
    reportAutomaticUpdateReloadSafety(true);
    const { rerender, unmount } = renderHook(
      ({ open }) => useAutomaticUpdateReloadBlocker(
        "ingredient-detail-dialog",
        open,
      ),
      { initialProps: { open: true } },
    );
    expect(getAutomaticUpdateReloadSafety()).toBe(false);

    rerender({ open: false });
    expect(getAutomaticUpdateReloadSafety()).toBe(true);

    unmount();
    reportAutomaticUpdateReloadSafety(false);
  });
});

describe("update reload inactivity tracking", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("becomes idle after one uninterrupted window and resets on interaction", () => {
    const onIdleChange = vi.fn();
    const stop = startUpdateReloadIdleTracking(onIdleChange, 60_000);

    vi.advanceTimersByTime(59_999);
    expect(onIdleChange).not.toHaveBeenCalled();
    window.dispatchEvent(new MouseEvent("mousedown"));
    vi.advanceTimersByTime(59_999);
    expect(onIdleChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdleChange).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(onIdleChange).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(60_000);
    expect(onIdleChange).toHaveBeenLastCalledWith(true);
    stop();
  });

  it("cleans up listeners and a pending timer", () => {
    const onIdleChange = vi.fn();
    const stop = startUpdateReloadIdleTracking(onIdleChange, 60_000);
    stop();

    window.dispatchEvent(new TouchEvent("touchstart"));
    vi.advanceTimersByTime(120_000);
    expect(onIdleChange).not.toHaveBeenCalled();
  });

  it("runs stale recovery only after safe idle and keeps the reload guard live", () => {
    reportAutomaticUpdateReloadSafety(false);
    const recover = vi.fn();
    const stop = scheduleSafeIdleAutomaticRecovery(recover, false, 100);

    vi.advanceTimersByTime(100);
    expect(recover).not.toHaveBeenCalled();

    reportAutomaticUpdateReloadSafety(true);
    expect(recover).not.toHaveBeenCalled();
    stop();
    const safeStop = scheduleSafeIdleAutomaticRecovery(recover, true, 100);
    vi.advanceTimersByTime(100);
    expect(recover).toHaveBeenCalledOnce();
    const canReload = recover.mock.calls[0][0] as () => boolean;
    expect(canReload()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(canReload()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(recover).toHaveBeenCalledOnce();

    safeStop();
    reportAutomaticUpdateReloadSafety(false);
  });

  it("cancels a pending safe-idle recovery", () => {
    reportAutomaticUpdateReloadSafety(true);
    const recover = vi.fn();
    const stop = scheduleSafeIdleAutomaticRecovery(recover, true, 100);
    stop();

    vi.advanceTimersByTime(100);
    expect(recover).not.toHaveBeenCalled();
    reportAutomaticUpdateReloadSafety(false);
  });
});