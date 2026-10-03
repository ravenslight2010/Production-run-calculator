import { describe, expect, it, vi } from "vitest";
import {
  CALCULATOR_MANUAL_SECTION_ERROR_EVENT,
  emitManualSectionError,
  subscribeToManualSectionErrors,
} from "./manualSectionErrors";

describe("manual section error notices", () => {
  it("delivers failure messages to the active UI subscriber and stops after cleanup", () => {
    const onError = vi.fn();
    const unsubscribe = subscribeToManualSectionErrors(onError);

    emitManualSectionError({
      runId: "run-1",
      section: "packaging",
      failure: "permission",
      message: "You do not have permission to save this correction.",
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      "You do not have permission to save this correction.",
    );

    unsubscribe();
    emitManualSectionError({
      runId: "run-1",
      section: "packaging",
      message: "This correction failed.",
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("ignores malformed events without a non-empty message", () => {
    const onError = vi.fn();
    const unsubscribe = subscribeToManualSectionErrors(onError);
    window.dispatchEvent(new CustomEvent(CALCULATOR_MANUAL_SECTION_ERROR_EVENT, {
      detail: { runId: "run-1", section: "packaging", message: "  " },
    }));
    window.dispatchEvent(new CustomEvent(CALCULATOR_MANUAL_SECTION_ERROR_EVENT, {
      detail: { runId: "run-1", section: "packaging", message: 401 },
    }));
    expect(onError).not.toHaveBeenCalled();
    unsubscribe();
  });
});