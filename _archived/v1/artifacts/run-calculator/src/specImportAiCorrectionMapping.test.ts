import { describe, expect, it } from "vitest";
import type { SpecAliasKind, SpecImportAlias } from "@workspace/spec-import";
import { mapSpecAliasToAiCorrection } from "./specImport";

const makeAlias = (kind: SpecAliasKind): SpecImportAlias =>
  ({
    kind,
    externalName: "Reviewed source label",
    canonicalName: "Canonical target",
    context: null,
  }) as SpecImportAlias;

describe("spec alias to shared AI correction mapping", () => {
  it.each([
    ["brand", "brand"],
    ["flavor", "flavor"],
    ["appType", "item"],
    ["pepType", "item"],
    ["recipeName", "item"],
    ["cheeseIngredient", "ingredient"],
    ["doughIngredient", "ingredient"],
    ["sauceIngredient", "ingredient"],
    ["dieType", "die"],
  ] as const)("maps %s to %s", (kind, domain) => {
    expect(mapSpecAliasToAiCorrection(makeAlias(kind))).toEqual({
      domain,
      fromText: "Reviewed source label",
      toText: "Canonical target",
    });
  });

  it("does not mirror routing choices or unknown future kinds as ingredient corrections", () => {
    expect(mapSpecAliasToAiCorrection(makeAlias("crossFamilyRouting"))).toBeNull();
    expect(
      mapSpecAliasToAiCorrection(
        makeAlias("unknownFutureKind" as SpecAliasKind),
      ),
    ).toBeNull();
  });
});