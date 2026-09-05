import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
// The Mix Plan panel lives in its own component (refactor step 4b); the
// "incomplete mix → Mix Recipes" label moved with it.
const mixesTabSource = readFileSync(resolve(process.cwd(), "src/components/MixesTabContent.tsx"), "utf8");

describe("mix destination labels", () => {
  it("keeps the operational menu and recipe-management sub-tab distinct", () => {
    expect(homeSource).toMatch(
      /<DropdownMenuItem onClick=\{\(\) => setActiveTab\("mixes"\)\}>\s*<Blend className="w-4 h-4 mr-2" \/> Mix Plan\s*<\/DropdownMenuItem>/,
    );
    expect(homeSource).toMatch(/mixes: "Mix Recipes"/);
  });

  it("directs incomplete mix definitions to Mix Recipes", () => {
    expect(homeSource).toContain("added to Mix Recipes — set batch size and per-pizza amounts there.");
    expect(mixesTabSource).toContain("open Mix Recipes to enter them");
  });
});