import { describe, it, expect } from "vitest";
import {
  collectSpecRenameAliases,
  mergeSpecAliases,
  dropConflictingSpecAliases,
  canonicalize,
  type SpecImportAlias,
  type SpecProfileRename,
} from "./index";

const rename = (
  fb: string,
  ff: string,
  tb: string,
  tf: string,
): SpecProfileRename => ({ from: { brand: fb, flavor: ff }, to: { brand: tb, flavor: tf } });

describe("collectSpecRenameAliases", () => {
  it("learns a manual brand rename as brand alias (shown name = raw sheet label)", () => {
    const out = collectSpecRenameAliases(
      [rename('11" Four Hands', "Cheese", "Four Hands", "Cheese")],
      [],
    );
    expect(out).toEqual([
      { kind: "brand", externalName: '11" Four Hands', canonicalName: "Four Hands", context: null },
    ]);
  });

  it("learns a flavor rename with the CONFIRMED brand as context", () => {
    const out = collectSpecRenameAliases(
      [rename('11" Four Hands', "Chz", "Four Hands", "Cheese")],
      [],
    );
    expect(out).toContainEqual({
      kind: "flavor",
      externalName: "Chz",
      canonicalName: "Cheese",
      context: "Four Hands",
    });
    expect(out).toContainEqual({
      kind: "brand",
      externalName: '11" Four Hands',
      canonicalName: "Four Hands",
      context: null,
    });
  });

  it("emits nothing when names are unchanged (or differ only by case)", () => {
    expect(
      collectSpecRenameAliases([rename("Bobo's", "Cheese", "bobo's", "CHEESE")], []),
    ).toEqual([]);
  });

  it("skips an AMBIGUOUS brand rename (same shown brand renamed two ways)", () => {
    const out = collectSpecRenameAliases(
      [
        rename("Lowe's", "Cheese", "Lowe's 7\"", "Cheese"),
        rename("Lowe's", "Pepperoni", "Lowe's 11\"", "Pepperoni"),
      ],
      [],
    );
    expect(out.filter((a) => a.kind === "brand")).toEqual([]);
  });

  it("skips an ambiguous flavor rename but keeps the consistent brand rename", () => {
    const out = collectSpecRenameAliases(
      [
        rename("B", "Chz", "Brand", "Cheese"),
        rename("B", "Chz", "Brand", "Mozzarella"),
      ],
      [],
    );
    expect(out.filter((a) => a.kind === "flavor")).toEqual([]);
    expect(out).toContainEqual({
      kind: "brand",
      externalName: "B",
      canonicalName: "Brand",
      context: null,
    });
  });

  it("re-points a PRIOR raw→shown alias to raw→edited (no chain)", () => {
    const prior: SpecImportAlias[] = [
      { kind: "brand", externalName: "11 IN FOUR HANDS", canonicalName: "Four Hands 11", context: null },
    ];
    const out = collectSpecRenameAliases(
      [rename("Four Hands 11", "Cheese", "Four Hands", "Cheese")],
      prior,
    );
    expect(out).toContainEqual({
      kind: "brand",
      externalName: "11 IN FOUR HANDS",
      canonicalName: "Four Hands",
      context: null,
    });
    // The shown label itself is also learned for sheets that literally say it.
    expect(out).toContainEqual({
      kind: "brand",
      externalName: "Four Hands 11",
      canonicalName: "Four Hands",
      context: null,
    });
    // The merged save list must survive the chain/cycle filter.
    const merged = mergeSpecAliases(prior, out);
    const usable = dropConflictingSpecAliases(merged);
    expect(usable.length).toBe(merged.length);
    // But APPLYING the raw→edited alias is now blocked by the digit-signature
    // hygiene guard: "11 IN FOUR HANDS" (digits: 11) must never be renamed to
    // the digit-less "Four Hands" — the same rule that stops a 7" brand from
    // collapsing into its plain sibling. The raw label stays as-is.
    expect(canonicalize("11 IN FOUR HANDS", [], merged, "brand").value).toBe("11 IN FOUR HANDS");
    // A digit-compatible rename still applies.
    expect(canonicalize("Four Hands 11", ["Four Hands 11"], merged, "brand").value).toBe("Four Hands 11");
  });

  it("re-points a prior flavor alias under the OLD brand context to the confirmed pair", () => {
    const prior: SpecImportAlias[] = [
      { kind: "flavor", externalName: "CHZ MIX", canonicalName: "Chz", context: "Old Brand" },
    ];
    const out = collectSpecRenameAliases(
      [rename("Old Brand", "Chz", "New Brand", "Cheese")],
      prior,
    );
    expect(out).toContainEqual({
      kind: "flavor",
      externalName: "CHZ MIX",
      canonicalName: "Cheese",
      context: "New Brand",
    });
  });

  it("ignores prior aliases of other kinds and other names", () => {
    const prior: SpecImportAlias[] = [
      { kind: "pepType", externalName: "PEP", canonicalName: "Old", context: null },
      { kind: "brand", externalName: "X", canonicalName: "Unrelated", context: null },
    ];
    const out = collectSpecRenameAliases([rename("Old", "F", "New", "F")], prior);
    expect(out).toEqual([
      { kind: "brand", externalName: "Old", canonicalName: "New", context: null },
    ]);
  });

  it("skips empty from/to names", () => {
    expect(collectSpecRenameAliases([rename("", "", "Brand", "Cheese")], [])).toEqual([]);
    expect(collectSpecRenameAliases([rename("Brand", "Cheese", "", "")], [])).toEqual([]);
  });
});

describe("mergeSpecAliases", () => {
  it("replaces base entries on identity-key collisions (rename wins)", () => {
    const base: SpecImportAlias[] = [
      { kind: "brand", externalName: "RAW", canonicalName: "Old", context: null },
      { kind: "flavor", externalName: "F", canonicalName: "G", context: "B" },
    ];
    const overrides: SpecImportAlias[] = [
      { kind: "brand", externalName: "raw ", canonicalName: "New", context: null },
    ];
    expect(mergeSpecAliases(base, overrides)).toEqual([
      { kind: "flavor", externalName: "F", canonicalName: "G", context: "B" },
      { kind: "brand", externalName: "raw ", canonicalName: "New", context: null },
    ]);
  });

  it("keeps flavor keys distinct by context", () => {
    const base: SpecImportAlias[] = [
      { kind: "flavor", externalName: "F", canonicalName: "G", context: "Brand A" },
    ];
    const overrides: SpecImportAlias[] = [
      { kind: "flavor", externalName: "F", canonicalName: "H", context: "Brand B" },
    ];
    expect(mergeSpecAliases(base, overrides)).toHaveLength(2);
  });
});
