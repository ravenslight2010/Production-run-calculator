import { describe, it, expect } from "vitest";
import {
  buildParseSpecSheetPrompt,
  type ParseSpecSheetInput,
} from "./aiParseSpecSheet";

function input(overrides: Partial<ParseSpecSheetInput> = {}): ParseSpecSheetInput {
  return {
    workbookText: "Brand\tFlavor\tSize\nLowes\tPepperoni\t7in\n",
    ...overrides,
  } as ParseSpecSheetInput;
}

// Regression guard for the spec-sheet importer: when one brand's sheet covers
// several SIZE variants (7in / 11in), the model must fold the size into the
// BRAND name (brand "Lowes 7in"), never leave it dangling in the flavor
// ("7in Pepperoni"). The instruction lives in the system prompt; this test
// pins it so the rule can't be silently dropped from the prompt.
describe("buildParseSpecSheetPrompt size→brand rule", () => {
  it("instructs the model to fold size into the brand, not the flavor", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    // Size is folded INTO the brand name.
    expect(system).toContain("fold the size INTO");
    expect(system).toContain("THE BRAND");
    // Concrete worked example: brand carries the size, flavor stays clean.
    expect(system).toContain("brand='Lowes 7in'");
    expect(system).toContain("flavor='Pepperoni'");
    // And the explicit anti-pattern it must avoid.
    expect(system).toContain("NOT brand='Lowes', flavor='7in Pepperoni'");
  });

  it("applies the same size→brand rule to recipes and targets", () => {
    const { system } = buildParseSpecSheetPrompt(input());
    expect(system).toContain("recipe brand/flavor and `targets` the same way");
  });
});
