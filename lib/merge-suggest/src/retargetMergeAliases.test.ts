import { describe, expect, it } from "vitest";
import {
  retargetMergeAliases,
  suggestionsFromAliases,
  type MergeAlias,
} from "./index";

describe("retargetMergeAliases", () => {
  it("moves older aliases to the new survivor and saves the direct merge", () => {
    const existing: MergeAlias[] = [
      { externalName: "A", canonicalName: "B" },
      { externalName: "Other", canonicalName: "Still active" },
    ];

    const retargeted = retargetMergeAliases(existing, ["B"], "C");
    expect(retargeted).toEqual([
      { externalName: "A", canonicalName: "C" },
      { externalName: "B", canonicalName: "C" },
    ]);
    expect(suggestionsFromAliases(["A", "C"], retargeted)).toEqual([
      { target: "C", sources: ["A"], reason: "Previously merged" },
    ]);
  });

  it("matches merged names case-insensitively and prefers direct source mappings", () => {
    const existing: MergeAlias[] = [
      { externalName: "B", canonicalName: "Earlier target" },
      { externalName: "A", canonicalName: " b " },
      { externalName: "a", canonicalName: "B" },
    ];

    expect(retargetMergeAliases(existing, ["B"], "C")).toEqual([
      { externalName: "a", canonicalName: "C" },
      { externalName: "B", canonicalName: "C" },
    ]);
  });

  it("does not emit self-references or mappings for aliases outside the merge", () => {
    expect(
      retargetMergeAliases(
        [
          { externalName: "B", canonicalName: "B" },
          { externalName: "C", canonicalName: "B" },
          { externalName: "A", canonicalName: "Unrelated" },
        ],
        ["B", "C"],
        "C",
      ),
    ).toEqual([{ externalName: "B", canonicalName: "C" }]);
  });
});
