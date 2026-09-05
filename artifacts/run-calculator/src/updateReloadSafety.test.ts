import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAutomaticUpdateReloadSafety,
  hasAutomaticUpdateReloadBlockingSurface,
  isAutomaticUpdateReloadSafe,
  reportAutomaticUpdateReloadBlocker,
  reportAutomaticUpdateReloadSafety,
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
    })).toBe(true);

    for (const unsafeField of [
      "hasActiveRun",
      "hasUnsavedForm",
      "hasBlockingDialog",
      "hasBlockingOperation",
    ] as const) {
      expect(isAutomaticUpdateReloadSafe({
        hasActiveRun: false,
        hasUnsavedForm: false,
        hasBlockingDialog: false,
        hasBlockingOperation: false,
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
  ])("blocks %s", (_label, unsafe) => {
    expect(isAutomaticUpdateReloadSafe({
      hasActiveRun: false,
      hasUnsavedForm: false,
      hasBlockingDialog: false,
      hasBlockingOperation: false,
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
});