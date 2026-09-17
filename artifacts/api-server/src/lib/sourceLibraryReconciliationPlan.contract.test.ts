import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SOURCE_LIBRARY_RECONCILIATION_PLAN_JSON_BASE64 } from "./sourceLibraryReconciliationPlan.generated";
import {
  SOURCE_LIBRARY_RECONCILIATION_PLAN,
  SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
  SOURCE_LIBRARY_RECONCILIATION_V1_EXPECTED_PLAN_SHA256,
} from "./sourceLibraryReconciliationHeal";

describe("source-library v1 immutable plan contract", () => {
  it("uses runtime-stable base64 bytes for the canonical payload", () => {
    const json = Buffer.from(SOURCE_LIBRARY_RECONCILIATION_PLAN_JSON_BASE64, "base64").toString("utf8");
    expect(Buffer.from(json, "utf8").toString("base64"))
      .toBe(SOURCE_LIBRARY_RECONCILIATION_PLAN_JSON_BASE64);
    expect(createHash("sha256").update(json).digest("hex"))
      .toBe(SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256);
  });

  it("pins generated content to the independent reviewed digest and deep-freezes it", () => {
    expect(SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256)
      .toBe(SOURCE_LIBRARY_RECONCILIATION_V1_EXPECTED_PLAN_SHA256);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN)).toBe(true);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements)).toBe(true);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements[0].after)).toBe(true);
  });
});