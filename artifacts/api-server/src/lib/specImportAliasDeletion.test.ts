import { describe, expect, it } from "vitest";
import {
  matchesSpecImportAliasDeletion,
  type SpecImportAliasDeletionEntry,
} from "./specImportAliasDeletion";

const entry: SpecImportAliasDeletionEntry = {
  kind: "appType",
  externalName: "Sheet Blend",
  canonicalName: "Wrong Blend",
  context: null,
};

describe("matchesSpecImportAliasDeletion", () => {
  it("matches only the context-free row when exact context is requested", () => {
    expect(matchesSpecImportAliasDeletion({ ...entry, context: null }, entry, true)).toBe(true);
    expect(matchesSpecImportAliasDeletion({ ...entry, context: "Acme" }, entry, true)).toBe(false);
  });

  it("keeps legacy null-context wildcard matching for callers that need it", () => {
    expect(matchesSpecImportAliasDeletion({ ...entry, context: "Acme" }, entry, false)).toBe(true);
  });

  it("always matches a provided context exactly", () => {
    const scoped = { ...entry, context: "Acme" };
    expect(matchesSpecImportAliasDeletion({ ...scoped, context: "Acme" }, scoped, true)).toBe(true);
    expect(matchesSpecImportAliasDeletion({ ...scoped, context: "Other" }, scoped, false)).toBe(false);
  });
});