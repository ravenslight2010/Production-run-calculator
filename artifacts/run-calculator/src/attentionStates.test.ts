import { describe, expect, it } from "vitest";
import {
  ATTENTION_STATE_LABEL,
  attentionStateForSeverity,
  nextActionForAttention,
} from "./attentionStates";

describe("manager attention states", () => {
  it("distinguishes blockers, review work, recoverable stale work, and information", () => {
    expect(attentionStateForSeverity("error")).toBe("blocker");
    expect(attentionStateForSeverity("warning")).toBe("review");
    expect(attentionStateForSeverity("warning", "deferred")).toBe("stale");
    expect(attentionStateForSeverity("info")).toBe("info");
    expect(ATTENTION_STATE_LABEL.stale).toBe("Recoverable stale");
  });

  it("does not make historical or deferred work newly urgent", () => {
    expect(nextActionForAttention("stale", "deferred")).toBe("Resume or reassign");
    expect(nextActionForAttention("stale", "historical")).toBe("Review when convenient");
    expect(nextActionForAttention("blocker", "resolved")).toBe("No action needed");
  });
});