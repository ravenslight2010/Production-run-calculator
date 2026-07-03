// @vitest-environment jsdom
//
// Mobile counterpart of SpecImportDialog.warnings.test.tsx: proves the mobile
// import review screen (artifacts/run-calculator-mobile/components/
// SpecImportModal.tsx) surfaces flavor-correction warnings ({brand, flavor,
// message}[] on parsed.warnings), so a regression there can't silently hide
// corrections from managers importing spec sheets on mobile.
//
// DESIGN NOTE (why the assertions differ from the web test): the mobile modal
// intentionally has NO per-profile rows — the editable per-item review is a
// web-only feature (mobile parity deferred; see .agents/memory/spec-import.md).
// Instead, mobile renders EVERY warning inside the single top-level amber
// callout, each labeled with its product as "Brand — Flavor" plus the message.
// That is the mobile equivalent of the web's matched-row + unmatched-fallback
// split: matched or not, case-mismatched or not, every correction is visible.
// This suite pins exactly that contract:
//  1. The top-level callout renders (with the count summary) when
//     parsed.warnings is non-empty.
//  2. A warning whose brand+flavor corresponds to a parsed profile renders its
//     "Brand — Flavor" label and message (the per-profile attachment on mobile).
//  3. A warning matching NO profile (the web unmatched fallback) still surfaces
//     in the same callout — never hidden.
//  4. A warning whose brand/flavor differ from the profile only by case or
//     whitespace still surfaces (case differences can't hide a correction).
//  5. No warning callout renders when the parse result carries no warnings.
//
// The mobile component sits behind a React Native / Expo import graph that
// can't load in node, so it is pulled in through the strip-imports ->
// transpile-to-CJS -> inject-React pipeline documented in
// .agents/memory/web-test-harness.md (same pattern as recipeAssistApply.test.tsx).

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import type {
  ParsedProfile,
  ParsedSpecImport,
  SpecImportWarning,
} from "@workspace/spec-import";

// ── Mobile component loader (strip-imports -> transpile-to-CJS -> evaluate) ────
const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../../../run-calculator-mobile/components/SpecImportModal.tsx",
);

// Stubs for the symbols the stripped imports used to provide. Everything the
// modal touches at module-eval time (StyleSheet.create) or render time is here;
// React itself is injected separately so the component shares this test's React
// instance (a second copy would break the hook dispatcher). RN primitives render
// plain host elements jsdom understands so textContent assertions work.
const STUB_PRELUDE = `
const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1 };
const Modal = (p) => React.createElement("div", null, p && p.children);
const View = (p) => React.createElement("div", null, p && p.children);
const ScrollView = (p) => React.createElement("div", null, p && p.children);
const Pressable = (p) => React.createElement("div", { onClick: p && p.onPress }, p && p.children);
const Text = (p) => React.createElement("span", null, p && p.children);
const ActivityIndicator = () => null;
const Feather = () => null;
const ReviewBadge = () => null;
const useColors = () => ({
  background: "#000",
  border: "#111",
  foreground: "#222",
  mutedForeground: "#333",
  primary: "#444",
  primaryForeground: "#555",
  destructive: "#666",
  warning: "#777",
  success: "#888",
});
`;

// Prop + prepared shapes the mobile modal reads (mirrors mobile
// context/specImport.ts SpecImportPrepared — no skipped/brands/flavorsByBrand,
// unlike the web SpecImportPrepared).
type MobilePrepared = {
  parsed: ParsedSpecImport;
  summary: {
    profilesNew: number;
    profilesUpdated: number;
    recipesNew: number;
    recipesUpdated: number;
    totalProfiles: number;
    totalRecipes: number;
  };
  newAliases: unknown[];
  flagged: unknown[];
  discrepancies: unknown[];
  note?: string;
};

type ModalFn = (props: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  progress?: { done: number; total: number } | null;
  error: string | null;
  prepared: MobilePrepared | null;
  applying: boolean;
  onConfirm: () => void;
}) => React.ReactElement | null;

function loadMobileSpecImportModal(): ModalFn {
  const ts = require("typescript") as typeof import("typescript");
  const raw = fs.readFileSync(MOBILE_FILE, "utf8");
  // Drop every `import ... from "...";` (incl. multiline + `import type`). The
  // symbols they provided come from STUB_PRELUDE or the injected React.
  const withoutImports = raw.replace(/import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g, "");
  const { outputText } = ts.transpileModule(STUB_PRELUDE + withoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      isolatedModules: true,
    },
  });
  const factory = new Function("exports", "require", "React", outputText);
  const mod: { default?: ModalFn } = {};
  factory(mod, () => ({}), React);
  if (!mod.default) throw new Error("mobile SpecImportModal default export not found");
  return mod.default;
}

let MobileSpecImportModal: ModalFn;

beforeAll(() => {
  MobileSpecImportModal = loadMobileSpecImportModal();
});

afterEach(() => cleanup());

function profile(brand: string, flavor: string): ParsedProfile {
  return { brand, flavor };
}

function makePrepared(
  profiles: ParsedProfile[],
  warnings?: SpecImportWarning[],
): MobilePrepared {
  const parsed: ParsedSpecImport = { profiles, recipes: [] };
  if (warnings?.length) parsed.warnings = warnings;
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: 0,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: 0,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
  };
}

function renderModal(prepared: MobilePrepared): HTMLElement {
  const { container } = render(
    React.createElement(MobileSpecImportModal, {
      visible: true,
      onClose: () => {},
      loading: false,
      error: null,
      prepared,
      applying: false,
      onConfirm: () => {},
    }),
  );
  return container;
}

// The RN Text nesting splits sentences across host text nodes, so assertions go
// through the container's normalized textContent rather than getByText.
function textOf(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("SpecImportModal (mobile) flavor-correction warnings", () => {
  it("renders the top-level warnings callout with the count and the matching product's label + message", () => {
    const container = renderModal(
      makePrepared(
        [profile("Tombstone", "Pepperoni"), profile("DiGiorno", "Four Cheese")],
        [
          {
            brand: "Tombstone",
            flavor: "Pepperoni",
            message: 'Flavor "Pepperonni" was corrected to "Pepperoni".',
          },
        ],
      ),
    );
    const text = textOf(container);

    // Top-level callout with the count summary.
    expect(text).toContain("1 item was corrected or flagged");

    // The warning is attached to its product: the "Brand — Flavor" label of the
    // matching parsed profile renders together with the correction message.
    expect(text).toContain("Tombstone — Pepperoni");
    expect(text).toContain('Flavor "Pepperonni" was corrected to "Pepperoni".');

    // The unrelated profile gets no warning label of its own.
    expect(text).not.toContain("DiGiorno — Four Cheese");
  });

  it("still surfaces a warning whose brand/flavor differ from the profile only by case/whitespace", () => {
    const container = renderModal(
      makePrepared(
        [profile("Tombstone", "Pepperoni")],
        [
          {
            brand: "  tombstone ",
            flavor: "PEPPERONI",
            message: "Check this flavor name.",
          },
        ],
      ),
    );
    const text = textOf(container);

    // Case/whitespace differences must never hide the correction: the callout
    // renders with the warning's own label and message.
    expect(text).toContain("1 item was corrected or flagged");
    expect(text).toContain("tombstone — PEPPERONI");
    expect(text).toContain("Check this flavor name.");
  });

  it("surfaces warnings with no matching profile in the top-level callout instead of hiding them", () => {
    const container = renderModal(
      makePrepared(
        [profile("Tombstone", "Pepperoni")],
        [
          {
            brand: "Red Baron",
            flavor: "Supreme",
            message: 'Flavor "Suprême" did not match any product on the sheet.',
          },
        ],
      ),
    );
    const text = textOf(container);

    // The unmatched warning is listed in the callout with its own label.
    expect(text).toContain("1 item was corrected or flagged");
    expect(text).toContain("Red Baron — Supreme");
    expect(text).toContain('Flavor "Suprême" did not match any product on the sheet.');
  });

  it("lists every warning for the same product and pluralizes the count", () => {
    const container = renderModal(
      makePrepared(
        [profile("Tombstone", "Pepperoni")],
        [
          { brand: "Tombstone", flavor: "Pepperoni", message: "First warning." },
          { brand: "Tombstone", flavor: "Pepperoni", message: "Second warning." },
        ],
      ),
    );
    const text = textOf(container);

    expect(text).toContain("2 items were corrected or flagged");
    expect(text).toContain("First warning.");
    expect(text).toContain("Second warning.");
  });

  it("renders no warning callout when the parse result carries no warnings", () => {
    const container = renderModal(
      makePrepared([profile("Tombstone", "Pepperoni")]),
    );
    const text = textOf(container);

    expect(text).not.toContain("corrected or flagged");
    // The rest of the review still renders (summary + help copy).
    expect(text).toContain("Spec profiles");
  });

  it("renders no warning callout when parsed.warnings is an empty array", () => {
    const prepared = makePrepared([profile("Tombstone", "Pepperoni")]);
    prepared.parsed.warnings = [];
    const container = renderModal(prepared);

    expect(textOf(container)).not.toContain("corrected or flagged");
  });
});
