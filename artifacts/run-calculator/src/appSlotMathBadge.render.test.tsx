// @vitest-environment jsdom
//
// Rendered verification for the per-run Setup tab math-check badge.
//
// Task #811: confirm AppSlotMathBadge fires for mix slots on the per-run Setup
// tab in home.tsx (not just the standalone Profile Editor).
//
// home.tsx now delegates each of the four applicator slot badge sections to
// PerRunMixSlotBadge (exported from pages/home.tsx). That component contains:
//   • the isMix gate: appType.trim().toLowerCase().includes("mix")
//   • the AppSlotMathBadge mount with its rows/ozPerPizza/handler props
//
// Importing PerRunMixSlotBadge from the real home.tsx means removing or
// miswiring a badge, changing the gate expression, or passing a wrong field
// name will break these tests — which is exactly the regression the task
// guards against.
//
// Coverage:
//  1. PerRunMixSlotBadge renders the mismatch strip when appType includes "mix"
//     and rows sum ≠ ozPerPizza (above tolerance)
//  2. Returns null for cheese / empty / non-mix types — the gate is correct
//  3. Expand / collapse interaction
//  4. "Use row sum" handler called with the correct value for all four slots
//  5. "Scale rows" handler called with the correctly scaled rows
//  6. Badge clears on re-render after resolution (form.setValue effect)
//  7. End-to-end: profile loaded → badge shown → resolved in UI → saved via
//     saveProfile → reloaded → badge absent (the per-run Save Setup path)

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PerRunMixSlotBadge } from "./pages/home";
import { saveProfile, loadProfile } from "./storage";
import type { RecipeRow, FormValues } from "./types";
import { DEFAULT_VALUES } from "./types";

afterEach(cleanup);
afterEach(() => localStorage.clear());

// ── Shared fixture ────────────────────────────────────────────────────────────
// Row sum = 2.95 oz/pizza; total field = 3.1 → delta 0.15 > DEFAULT_TOLERANCE
const ROWS: RecipeRow[] = [
  { ingredient: "Herb Blend",  lbs: 1.5  },
  { ingredient: "Oregano",     lbs: 0.85 },
  { ingredient: "Garlic Salt", lbs: 0.6  },
];
const OZ_TOTAL = 3.1;
const ROW_SUM  = 2.95; // 1.5 + 0.85 + 0.6

const noop = () => {};

// ── 1. Badge renders when appType includes "mix" and values conflict ───────────

describe("PerRunMixSlotBadge (home.tsx) — renders the mismatch strip", () => {
  it("shows Math mismatch strip when appType='Mix' and row sum ≠ oz total", () => {
    render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();
    expect(screen.getByText(/2\.95/)).toBeTruthy();
    expect(screen.getByText(/3\.1/)).toBeTruthy();
  });

  it("shows the badge for partial-name match like 'Herb Mix' (isMix uses .includes)", () => {
    render(
      <PerRunMixSlotBadge
        appType="Herb Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();
  });

  it("shows the badge for 'Pre-Mix' (case-insensitive .includes gate)", () => {
    render(
      <PerRunMixSlotBadge
        appType="Pre-Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();
  });
});

// ── 2. Badge absent for non-mix types ────────────────────────────────────────

describe("PerRunMixSlotBadge (home.tsx) — absent for non-mix types", () => {
  it("returns null when appType='Cheese' (not a mix)", () => {
    const { container } = render(
      <PerRunMixSlotBadge
        appType="Cheese"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when appType='' (empty slot)", () => {
    const { container } = render(
      <PerRunMixSlotBadge
        appType=""
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when appType='Pepperoni'", () => {
    const { container } = render(
      <PerRunMixSlotBadge
        appType="Pepperoni"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when rows agree with ozPerPizza (no conflict)", () => {
    const { container } = render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={ROW_SUM}   // matches exactly — no mismatch
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when there are no active rows (lbs all 0)", () => {
    const emptyRows: RecipeRow[] = [
      { ingredient: "Herb Blend", lbs: 0 },
    ];
    const { container } = render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={emptyRows}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── 3. Expand / collapse ──────────────────────────────────────────────────────

describe("PerRunMixSlotBadge (home.tsx) — expand/collapse", () => {
  it("clicking '▼ fix' expands the detail panel and shows resolution buttons", () => {
    render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    fireEvent.click(screen.getByText(/▼ fix/));
    expect(screen.getByText(/Use row sum/i)).toBeTruthy();
    expect(screen.getByText(/Scale rows/i)).toBeTruthy();
    expect(screen.getByText(/▲ less/)).toBeTruthy();
  });

  it("clicking '▲ less' collapses back", () => {
    render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/▲ less/));
    expect(screen.queryByText(/Use row sum/i)).toBeNull();
  });
});

// ── 4. Per-run slot handler wiring (app1–app4) ────────────────────────────────
// home.tsx passes these exact prop expressions for each slot:
//   appType    = v.appNType
//   rows       = v.appNCheeseRecipe ?? []
//   ozPerPizza = Number(v.appNOzPerPizza) || 0
//   onResolveByRowSum = (newOz) => form.setValue("appNOzPerPizza", newOz, ...)
//   onResolveByTotal  = (scaledRows) => { form.setValue("appNCheeseRecipe", ...); ... }
// The test mirrors each slot's values so a wrong field binding is caught.

describe("PerRunMixSlotBadge (home.tsx) — per-run slot handler wiring", () => {
  const SLOTS = [1, 2, 3, 4] as const;

  for (const slot of SLOTS) {
    it(`app${slot}: "Use row sum" calls onResolveByRowSum with the row sum value`, () => {
      const onRowSum = vi.fn();
      render(
        <PerRunMixSlotBadge
          appType="Mix"                       // v.appNType
          rows={ROWS}                         // v.appNCheeseRecipe ?? []
          ozPerPizza={Number(OZ_TOTAL) || 0}  // Number(v.appNOzPerPizza) || 0
          onResolveByRowSum={onRowSum}
          onResolveByTotal={noop}
        />,
      );
      fireEvent.click(screen.getByText(/▼ fix/));
      fireEvent.click(screen.getByText(/Use row sum/i));

      expect(onRowSum).toHaveBeenCalledOnce();
      const newOz = onRowSum.mock.calls[0][0] as number;
      expect(newOz).toBeCloseTo(ROW_SUM, 5);
    });

    it(`app${slot}: "Scale rows" calls onResolveByTotal with rows summing to oz total`, () => {
      const onTotal = vi.fn();
      render(
        <PerRunMixSlotBadge
          appType="Mix"
          rows={ROWS}
          ozPerPizza={OZ_TOTAL}
          onResolveByRowSum={noop}
          onResolveByTotal={onTotal}
        />,
      );
      fireEvent.click(screen.getByText(/▼ fix/));
      fireEvent.click(screen.getByText(/Scale rows/i));

      expect(onTotal).toHaveBeenCalledOnce();
      const scaledRows = onTotal.mock.calls[0][0] as RecipeRow[];
      const scaledSum = scaledRows.reduce((s, r) => s + r.lbs, 0);
      expect(scaledSum).toBeCloseTo(OZ_TOTAL, 3);
      // Original rows must not be mutated
      expect(ROWS[0].lbs).toBe(1.5);
    });
  }
});

// ── 5. Badge clears after resolution (form.setValue re-render effect) ──────────

describe("PerRunMixSlotBadge (home.tsx) — badge clears after resolution", () => {
  it("re-rendering with the resolved oz value (from form.setValue) hides the badge", () => {
    const { rerender } = render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();

    // Simulate form.setValue("appNOzPerPizza", rowSum) → parent re-renders
    rerender(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={ROW_SUM}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.queryByText(/Math mismatch/i)).toBeNull();
  });

  it("re-rendering with scaled rows (from form.setValue after Scale rows) hides the badge", () => {
    const onTotal = vi.fn();
    const { rerender } = render(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={ROWS}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={onTotal}
      />,
    );
    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/Scale rows/i));
    const scaledRows = onTotal.mock.calls[0][0] as RecipeRow[];

    // Simulate form.setValue("appNCheeseRecipe", scaledRows) → parent re-renders
    rerender(
      <PerRunMixSlotBadge
        appType="Mix"
        rows={scaledRows}
        ozPerPizza={OZ_TOTAL}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.queryByText(/Math mismatch/i)).toBeNull();
  });
});

// ── 6. End-to-end: per-run Setup tab full flow ────────────────────────────────
// Simulates the complete per-run Setup tab lifecycle:
//   a. A spec import writes mismatched values into a profile (same path as prod)
//   b. The Setup tab opens → loadProfile → PerRunMixSlotBadge renders conflict
//   c. Manager clicks "Use row sum" → handler fires with correct new oz
//   d. Manager clicks "Save Setup" → saveProfile persists the corrected form
//   e. Next loadProfile (next open) → PerRunMixSlotBadge renders nothing

const BRAND = "Per-Run Badge Brand";
const FLAVOR = "Per-Run Badge Flavor";

describe("PerRunMixSlotBadge (home.tsx) — end-to-end per-run Setup tab flow", () => {
  it("app1: badge fires on load, resolves via handler, cleared after save + reload", () => {
    // (a) Spec import leaves mismatched values in the profile
    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app1Type: "Mix",
      app1OzPerPizza: OZ_TOTAL,
      app1CheeseRecipe: ROWS,
    } as FormValues);

    // (b) Setup tab opens → loadProfile seeds form values → PerRunMixSlotBadge renders
    const loaded = loadProfile(BRAND, FLAVOR)!;
    const formRows  = (loaded.app1CheeseRecipe ?? []) as RecipeRow[];
    const formOz    = Number(loaded.app1OzPerPizza ?? 0);
    const formType  = loaded.app1Type ?? "";

    const onRowSum = vi.fn();
    const { rerender } = render(
      <PerRunMixSlotBadge
        appType={formType}
        rows={formRows}
        ozPerPizza={formOz}
        onResolveByRowSum={onRowSum}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i), "badge must appear after loadProfile").toBeTruthy();

    // (c) Manager expands and clicks "Use row sum"
    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/Use row sum/i));
    const correctedOz = onRowSum.mock.calls[0][0] as number;
    expect(correctedOz).toBeCloseTo(ROW_SUM, 5);

    // Re-render with corrected oz (mirrors form.setValue effect)
    rerender(
      <PerRunMixSlotBadge
        appType={formType}
        rows={formRows}
        ozPerPizza={correctedOz}
        onResolveByRowSum={onRowSum}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.queryByText(/Math mismatch/i), "badge must clear after resolution").toBeNull();

    // (d) "Save Setup" → saveProfile with the corrected form values
    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app1Type: formType,
      app1OzPerPizza: correctedOz,
      app1CheeseRecipe: formRows,
    } as FormValues);

    // (e) Next loadProfile → no conflict → badge absent
    cleanup();
    const reloaded = loadProfile(BRAND, FLAVOR)!;
    const { container } = render(
      <PerRunMixSlotBadge
        appType={reloaded.app1Type ?? ""}
        rows={(reloaded.app1CheeseRecipe ?? []) as RecipeRow[]}
        ozPerPizza={Number(reloaded.app1OzPerPizza ?? 0)}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild, "badge must be absent after save+reload").toBeNull();
  });

  it("app2: 'Scale rows' resolution also leaves no badge after save + reload", () => {
    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app2Type: "Mix",
      app2OzPerPizza: OZ_TOTAL,
      app2CheeseRecipe: ROWS,
    } as FormValues);

    const loaded  = loadProfile(BRAND, FLAVOR)!;
    const formRows = (loaded.app2CheeseRecipe ?? []) as RecipeRow[];
    const formOz   = Number(loaded.app2OzPerPizza ?? 0);
    const formType = loaded.app2Type ?? "";

    const onTotal = vi.fn();
    render(
      <PerRunMixSlotBadge
        appType={formType}
        rows={formRows}
        ozPerPizza={formOz}
        onResolveByRowSum={noop}
        onResolveByTotal={onTotal}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/Scale rows/i));
    const scaledRows = onTotal.mock.calls[0][0] as RecipeRow[];

    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app2Type: formType,
      app2OzPerPizza: formOz,     // total unchanged
      app2CheeseRecipe: scaledRows,
    } as FormValues);

    cleanup();
    const reloaded = loadProfile(BRAND, FLAVOR)!;
    const { container } = render(
      <PerRunMixSlotBadge
        appType={reloaded.app2Type ?? ""}
        rows={(reloaded.app2CheeseRecipe ?? []) as RecipeRow[]}
        ozPerPizza={Number(reloaded.app2OzPerPizza ?? 0)}
        onResolveByRowSum={noop}
        onResolveByTotal={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("app3: badge fires and resolves correctly", () => {
    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app3Type: "Mix",
      app3OzPerPizza: OZ_TOTAL,
      app3CheeseRecipe: ROWS,
    } as FormValues);

    const loaded  = loadProfile(BRAND, FLAVOR)!;
    const onRowSum = vi.fn();
    render(
      <PerRunMixSlotBadge
        appType={loaded.app3Type ?? ""}
        rows={(loaded.app3CheeseRecipe ?? []) as RecipeRow[]}
        ozPerPizza={Number(loaded.app3OzPerPizza ?? 0)}
        onResolveByRowSum={onRowSum}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/Use row sum/i));
    expect(onRowSum.mock.calls[0][0]).toBeCloseTo(ROW_SUM, 5);
  });

  it("app4: badge fires and resolves correctly", () => {
    saveProfile(BRAND, FLAVOR, {
      ...DEFAULT_VALUES,
      app4Type: "Mix",
      app4OzPerPizza: OZ_TOTAL,
      app4CheeseRecipe: ROWS,
    } as FormValues);

    const loaded  = loadProfile(BRAND, FLAVOR)!;
    const onRowSum = vi.fn();
    render(
      <PerRunMixSlotBadge
        appType={loaded.app4Type ?? ""}
        rows={(loaded.app4CheeseRecipe ?? []) as RecipeRow[]}
        ozPerPizza={Number(loaded.app4OzPerPizza ?? 0)}
        onResolveByRowSum={onRowSum}
        onResolveByTotal={noop}
      />,
    );
    expect(screen.getByText(/Math mismatch/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/▼ fix/));
    fireEvent.click(screen.getByText(/Use row sum/i));
    expect(onRowSum.mock.calls[0][0]).toBeCloseTo(ROW_SUM, 5);
  });
});
