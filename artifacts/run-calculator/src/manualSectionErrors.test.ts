import { describe, expect, it, vi } from "vitest";
import { ManualSectionEditErrorCode } from "@workspace/api-client-react";
import { MANUAL_SECTION_REJECTION_CODES } from "@workspace/sync-contract";
import {
  CALCULATOR_MANUAL_SECTION_ERROR_EVENT,
  emitManualSectionError,
  manualSectionRejectionMessage,
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

  it("maps only known rejection codes to safe, actionable messages", () => {
    const known = manualSectionRejectionMessage("section_changed");
    expect(known).toContain("Your edits are still here");
    expect(known).toContain("compare the latest counts");
    expect(manualSectionRejectionMessage("some server detail")).toBe(
      "This section could not be saved. Your edits are still here; review them and try again.",
    );
    expect(manualSectionRejectionMessage(undefined)).not.toContain("undefined");
  });

  it("keeps the shared client allowlist in sync with generated OpenAPI codes", () => {
    expect(Object.values(ManualSectionEditErrorCode).sort()).toEqual(
      [...MANUAL_SECTION_REJECTION_CODES].sort(),
    );
  });
});