import { describe, it, expect } from "vitest";
import {
  BRAND_DRIFT_RENAMES,
  brandDriftTargetFor,
  planBrandAliasRepoints,
  type AliasLike,
} from "./brandDriftHeal";

describe("brandDriftTargetFor", () => {
  it("maps each audited drifted spelling to its canonical customer", () => {
    expect(brandDriftTargetFor("Basha's Ultra Thin")).toBe("Basha's Ultra Thin Crust");
    expect(brandDriftTargetFor("Lucia's Morning Melts")).toBe("Lucia's Morning Melts 7in");
    expect(brandDriftTargetFor('FSD 7"')).toBe("FSD 7in");
    expect(brandDriftTargetFor("Aldo")).toBe("Aldo's");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(brandDriftTargetFor("  aldo  ")).toBe("Aldo's");
    expect(brandDriftTargetFor("BASHA'S ULTRA THIN")).toBe("Basha's Ultra Thin Crust");
  });

  it("never matches the canonical names themselves or prefixes/supersets", () => {
    for (const [, to] of BRAND_DRIFT_RENAMES) {
      expect(brandDriftTargetFor(to)).toBeNull();
    }
    expect(brandDriftTargetFor("Aldo's")).toBeNull();
    expect(brandDriftTargetFor("Basha's Ultra Thin Crust")).toBeNull();
    expect(brandDriftTargetFor("Basha's")).toBeNull();
    expect(brandDriftTargetFor("FSD 7in")).toBeNull();
    expect(brandDriftTargetFor("")).toBeNull();
    expect(brandDriftTargetFor("Corner Booth")).toBeNull();
  });
});

type Row = AliasLike & { id: number };
const row = (id: number, a: Partial<AliasLike>): Row => ({
  id,
  kind: "brand",
  externalName: "",
  canonicalName: "",
  context: null,
  ...a,
});

describe("planBrandAliasRepoints", () => {
  it("re-points brand aliases whose canonical is the drifted name", () => {
    const rows = [
      row(1, { externalName: "ALDO PIZZA CO", canonicalName: "Aldo" }),
      row(2, { externalName: "Someone Else", canonicalName: "Other" }),
    ];
    const plans = planBrandAliasRepoints(rows, "Aldo", "Aldo's");
    expect(plans).toEqual([
      { action: "update", row: rows[0], set: { canonicalName: "Aldo's", context: null } },
    ]);
  });

  it("deletes a chain row that would become a self-alias", () => {
    const rows = [row(1, { externalName: "aldo's", canonicalName: "Aldo" })];
    expect(planBrandAliasRepoints(rows, "Aldo", "Aldo's")).toEqual([
      { action: "delete", row: rows[0] },
    ]);
  });

  it("re-contexts flavor aliases scoped to the drifted brand", () => {
    const rows = [
      row(1, {
        kind: "flavor",
        externalName: "CHEESE",
        canonicalName: "Cheese",
        context: "basha's ultra thin",
      }),
      row(2, { kind: "flavor", externalName: "X", canonicalName: "Y", context: "Other" }),
    ];
    expect(
      planBrandAliasRepoints(rows, "Basha's Ultra Thin", "Basha's Ultra Thin Crust"),
    ).toEqual([
      { action: "update", row: rows[0], set: { context: "Basha's Ultra Thin Crust" } },
    ]);
  });

  it("leaves other kinds and non-matching rows untouched", () => {
    const rows = [
      row(1, { kind: "appType", externalName: "Aldo Blend", canonicalName: "Aldo" }),
      row(2, { externalName: "Aldo", canonicalName: "Aldo's" }),
    ];
    expect(planBrandAliasRepoints(rows, "Aldo", "Aldo's")).toEqual([]);
  });

  it("is a no-op for a degenerate rename", () => {
    const rows = [row(1, { externalName: "x", canonicalName: "Aldo" })];
    expect(planBrandAliasRepoints(rows, "Aldo", "aldo")).toEqual([]);
    expect(planBrandAliasRepoints(rows, "", "Aldo's")).toEqual([]);
  });
});
