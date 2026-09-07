import { describe, expect, it } from "vitest";
import {
  SOURCE_LIBRARY_RECONCILIATION_PLAN,
  SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
  SOURCE_LIBRARY_RECONCILIATION_V1_EXPECTED_PLAN_SHA256,
} from "./sourceLibraryReconciliationHeal";

describe("source-library v1 immutable plan contract", () => {
  it("pins generated content to the independent reviewed digest and deep-freezes it", () => {
    expect(SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256)
      .toBe(SOURCE_LIBRARY_RECONCILIATION_V1_EXPECTED_PLAN_SHA256);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN)).toBe(true);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements)).toBe(true);
    expect(Object.isFrozen(SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements[0].after)).toBe(true);
  });
});