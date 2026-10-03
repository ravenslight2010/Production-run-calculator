import { describe, expect, it } from "vitest";
import type { AiCorrection } from "@workspace/ai-memory";
import {
  appendCorrectionsBlock,
  MAX_AI_CORRECTION_CONTEXT_BYTES,
  MAX_AI_CORRECTION_CONTEXT_ENTRIES,
} from "./aiCorrectionsContext";

describe("AI correction prompt boundary", () => {
  it("bounds the complete appended context by entry count and rendered UTF-8 bytes", () => {
    const base = "selected workbook rows";
    const corrections: AiCorrection[] = Array.from({ length: 1_000 }, (_, index) => ({
      domain: "ingredient",
      fromText: `source-${index}-${"é".repeat(180)}`,
      toText: `target-${index}-${"é".repeat(180)}`,
    }));

    const output = appendCorrectionsBlock(base, corrections);
    const appended = output.slice(Buffer.byteLength(base, "utf8") === base.length ? base.length + 2 : base.length);

    expect(output).toContain("source-0-");
    expect(output).not.toContain(`source-${MAX_AI_CORRECTION_CONTEXT_ENTRIES}-`);
    expect(Buffer.byteLength(appended, "utf8")).toBeLessThanOrEqual(MAX_AI_CORRECTION_CONTEXT_BYTES);
    expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(
      Buffer.byteLength(base, "utf8") + 2 + MAX_AI_CORRECTION_CONTEXT_BYTES,
    );
  });
});