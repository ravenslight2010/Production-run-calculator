import { describe, expect, it } from "vitest";
import {
  extractReviewedDocument,
  specImagesAdapter,
  workbookTextAdapter,
} from "./reviewedDocumentExtraction";

const silentLog = { info() {}, warn() {}, error() {} };

describe("extractReviewedDocument", () => {
  it("uses the workbook adapter, sanitizes before review, and returns canonical suggestion metadata", async () => {
    const order: string[] = [];
    const result = await extractReviewedDocument({
      label: "test-workbook",
      log: silentLog,
      adapter: workbookTextAdapter,
      source: { kind: "workbook-text", workbookText: " Brand\tFlavor " },
      prompt: { system: "system", user: "already grounded prompt" },
      call: async (modelInput) => {
        expect(modelInput.source).toEqual({ kind: "workbook-text", workbookText: "Brand\tFlavor" });
        return '{"rows":["accepted","ignored"]}';
      },
      sanitize: (raw) => {
        order.push("sanitize");
        return (raw as { rows: string[] }).rows.slice(0, 1);
      },
      review: (rows) => {
        order.push("review");
        return [...rows, "reviewed"];
      },
      empty: () => [],
    });

    expect(result).toEqual({
      ok: true,
      data: ["accepted", "reviewed"],
      metadata: {
        aiGenerated: true,
        aiStatus: "enriched",
        modelStatus: "completed",
        decision: "suggestion",
      },
    });
    expect(order).toEqual(["sanitize", "review"]);
  });

  it("validates spec-image inputs before a provider call", async () => {
    let calls = 0;
    const result = await extractReviewedDocument({
      label: "test-images",
      log: silentLog,
      adapter: specImagesAdapter,
      source: { kind: "spec-images", images: [] },
      prompt: { system: "system", user: "grounded" },
      call: async () => {
        calls += 1;
        return "{}";
      },
      sanitize: () => "should not run",
      empty: () => "",
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      data: "",
      metadata: { aiStatus: "unavailable", modelStatus: "malformed", decision: "suggestion" },
    });
  });
});