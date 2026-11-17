// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reducedMotionRule =
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{\s*animation:\s*none\s*!important;\s*transition:\s*none\s*!important;\s*scroll-behavior:\s*auto\s*!important;\s*\}\s*\}\s*$/;

describe("reduced-motion styles", () => {
  it.each([
    ["run calculator", "./index.css"],
    ["screen preview sandbox", "../../mockup-sandbox/src/index.css"],
  ])("%s disables motion utilities for reduced-motion users", (_name, path) => {
    const css = readFileSync(new URL(path, import.meta.url), "utf8");

    expect(css).toMatch(reducedMotionRule);
  });
});
