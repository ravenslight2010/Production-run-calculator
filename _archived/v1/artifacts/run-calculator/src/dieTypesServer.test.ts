import { describe, it, expect } from "vitest";
import { reconcileDieTypes } from "./dieTypesServer";

const notDeleted = () => false;

describe("reconcileDieTypes", () => {
  it("unions server and local names, sorted, de-duped case-insensitively", () => {
    const { effective } = reconcileDieTypes(['12"', "Argus Dies"], ['7"', '12"'], notDeleted);
    expect(effective).toEqual(['12"', '7"', "Argus Dies"]);
  });

  it("folds server variant spellings through the canonical rename map", () => {
    const { effective } = reconcileDieTypes(['11" dies', "11"], [], notDeleted);
    expect(effective).toEqual(['11"']);
  });

  it("never resurrects a locally deleted die from the server list", () => {
    const { effective, toPush } = reconcileDieTypes(['12"', '7"'], ['7"'], n => n === '12"');
    expect(effective).toEqual(['7"']);
    expect(toPush).toEqual([]);
  });

  it("reports local-only names that need pushing to the server", () => {
    const { toPush } = reconcileDieTypes(['12"'], ["Argus Dies", '12"'], notDeleted);
    expect(toPush).toEqual(["Argus Dies"]);
  });

  it("prefers the local spelling when both sides have the same die", () => {
    const { effective, toPush } = reconcileDieTypes(["ARGUS DIES"], ["Argus Dies"], notDeleted);
    expect(effective).toEqual(["Argus Dies"]);
    expect(toPush).toEqual([]);
  });
});
