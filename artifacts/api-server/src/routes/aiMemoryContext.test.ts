// Unit tests for appendFacilityMemoryBlock's privileged-domain gating.
//
// GET /ai-memory/facility gates its response behind `use-ai-tools`, but several
// AI-prompt routes (ask-the-day chat, end-of-day summary, anomaly narration) are
// intentionally open to every signed-in user and ground themselves in the WHOLE
// facility-knowledge pool. Without excluding the privileged domains from that
// whole-pool fallback, a low-privilege account could recover forecast plans or
// proactive-alert history indirectly by asking the model to repeat what it read.
import { describe, it, expect } from "vitest";
import type { FacilityKnowledge } from "@workspace/ai-memory";
import { appendFacilityMemoryBlock } from "./aiMemoryContext";

function fact(domain: string, key: string, text: string): FacilityKnowledge {
  return { domain, key, fact: text, updatedAt: Date.now() } as FacilityKnowledge;
}

const knowledge: FacilityKnowledge[] = [
  fact("forecast", "plan:2026-06-20", "Predicted 300 cases of Tony's Pepperoni"),
  fact("proactive-alerts", "last:pace-stall", "Pace stall nudged twice this week"),
  fact("quality", "note:1", "Cheese moisture ran high on Tuesday"),
];

describe("appendFacilityMemoryBlock privileged-domain gating", () => {
  it("includes privileged domains by default (existing use-ai-tools-gated callers)", () => {
    const out = appendFacilityMemoryBlock("prompt", knowledge);
    expect(out).toContain("Tony's Pepperoni");
    expect(out).toContain("Pace stall");
  });

  it("includes privileged domains when allowPrivileged is explicitly true", () => {
    const out = appendFacilityMemoryBlock("prompt", knowledge, undefined, true);
    expect(out).toContain("Tony's Pepperoni");
    expect(out).toContain("Pace stall");
  });

  it("strips forecast and proactive-alert domains when allowPrivileged is false", () => {
    const out = appendFacilityMemoryBlock("prompt", knowledge, undefined, false);
    expect(out).not.toContain("Tony's Pepperoni");
    expect(out).not.toContain("Pace stall");
    expect(out).toContain("Cheese moisture");
  });

  it("does not gate an explicit domains allowlist even when allowPrivileged is false", () => {
    // An explicit `domains` filter is an opt-in by the caller (e.g. a route
    // building its own scoped block), so allowPrivileged only governs the
    // whole-pool fallback path, not an explicit allowlist.
    const out = appendFacilityMemoryBlock("prompt", knowledge, ["forecast"], false);
    expect(out).toContain("Tony's Pepperoni");
  });

  it("returns the prompt unchanged when nothing survives filtering", () => {
    const onlyPrivileged = [fact("forecast", "plan:x", "secret plan")];
    const out = appendFacilityMemoryBlock("prompt", onlyPrivileged, undefined, false);
    expect(out).toBe("prompt");
  });
});
