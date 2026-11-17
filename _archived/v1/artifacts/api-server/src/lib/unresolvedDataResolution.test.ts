import { describe, expect, it } from "vitest";
import {
  resolveUnresolvedData,
  resolveUnresolvedDataWithEnrichment,
} from "./unresolvedDataResolution";

const silentLog = { info() {}, warn() {}, error() {} };

describe("resolveUnresolvedData", () => {
  it("skips the model when deterministic resolution leaves nothing unresolved", async () => {
    let calls = 0;
    const result = await resolveUnresolvedData({
      label: "test",
      log: silentLog,
      input: ["Acme"],
      resolveDeterministically: () => ({ resolved: ["Acme"], unresolved: [] as string[] }),
      hasUnresolved: (items) => items.length > 0,
      buildModelInput: (items) => ({ names: items }),
      call: async () => {
        calls += 1;
        return "{}";
      },
      sanitize: () => [] as string[],
      merge: (resolved, suggestions) => [...resolved, ...suggestions],
    });

    expect(calls).toBe(0);
    expect(result).toEqual({
      data: ["Acme"],
      metadata: { aiGenerated: false, aiStatus: "deterministic", decision: "suggestion" },
    });
  });

  it("passes only unresolved data to the provider, sanitizes output, and marks it as a suggestion", async () => {
    const input = { known: ["Acme"], requested: ["Acme", "Akme"] };
    const result = await resolveUnresolvedData({
      label: "test",
      log: silentLog,
      input,
      resolveDeterministically: () => ({
        resolved: [{ candidate: "Acme", match: "Acme" }],
        unresolved: ["Akme"],
      }),
      hasUnresolved: (items) => items.length > 0,
      buildModelInput: (unresolved) => ({ alreadyGroundedPrompt: "match Akme", unresolved }),
      call: async (modelInput) => {
        expect(modelInput).toEqual({ alreadyGroundedPrompt: "match Akme", unresolved: ["Akme"] });
        expect(JSON.stringify(modelInput)).not.toContain("requested");
        return '{"matches":[{"candidate":"Akme","match":"Acme"},{"candidate":"invented","match":"Acme"}]}';
      },
      sanitize: (raw, unresolved) =>
        (raw as { matches: { candidate: string; match: string }[] }).matches.filter((match) =>
          unresolved.includes(match.candidate),
        ),
      merge: (resolved, suggestions) => [...resolved, ...suggestions],
    });

    expect(result).toEqual({
      data: [
        { candidate: "Acme", match: "Acme" },
        { candidate: "Akme", match: "Acme" },
      ],
      metadata: {
        aiGenerated: true,
        aiStatus: "enriched",
        modelStatus: "completed",
        decision: "suggestion",
      },
    });
  });

  it("recomputes request-local deterministic state immediately before merging", async () => {
    let deterministicCalls = 0;
    const result = await resolveUnresolvedData({
      label: "test",
      log: silentLog,
      input: "candidate",
      resolveDeterministically: () => ({
        resolved: [`resolved-${++deterministicCalls}`],
        unresolved: ["candidate"],
      }),
      hasUnresolved: (items) => items.length > 0,
      buildModelInput: (items) => ({ items }),
      call: async () => '{"matches":[]}',
      sanitize: () => [] as string[],
      merge: (resolved, suggestions) => [...resolved, ...suggestions],
    });

    expect(deterministicCalls).toBe(2);
    expect(result.data).toEqual(["resolved-2"]);
  });

  it("gives a cache-aware enrichment adapter only unresolved data", async () => {
    let received: string[] | undefined;
    const result = await resolveUnresolvedDataWithEnrichment({
      input: ["local", "remote"],
      resolveDeterministically: () => ({ resolved: ["local"], unresolved: ["remote"] }),
      hasUnresolved: (items) => items.length > 0,
      enrichUnresolved: async (items) => {
        received = items;
        return { suggestions: ["model-remote"], status: "enriched" as const };
      },
      emptySuggestions: () => [],
      merge: (resolved, suggestions) => [...resolved, ...suggestions],
    });

    expect(received).toEqual(["remote"]);
    expect(result.data).toEqual(["local", "model-remote"]);
    expect(result.metadata.aiStatus).toBe("enriched");
  });
});