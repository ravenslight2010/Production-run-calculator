// @workspace/recipe-guide-import
//
// Pure parsing + candidate-building logic for the two factory reference guides:
//   • Joe's Sauce Guide  (.docx plain-text)
//   • Pizza-to-Dough Recipe Guide  (.xlsx single-sheet)
//
// No DOM, no storage, no fetch — safe to use in vitest.

export { parseSauceGuide } from "./parseSauceGuide";
export type { SauceGuideRow } from "./parseSauceGuide";

export { parseDoughGuide } from "./parseDoughGuide";
export type { DoughGuideRow } from "./parseDoughGuide";

export { buildSauceCandidates, buildDoughCandidates, matchGuideName } from "./candidates";
export type { SauceGuideCandidate, DoughGuideCandidate } from "./candidates";
