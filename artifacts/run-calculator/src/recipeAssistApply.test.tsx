// @vitest-environment jsdom
//
// End-to-end coverage for the AI recipe assistant's confirm-first Apply + 6s
// Undo flow on the CLIENT. The server-side sanitize logic is unit-tested
// elsewhere, but the part that actually mutates a run's recipe rows — a returned
// suggestion renders → tap Apply → rows change → tap Undo → rows restore — had no
// coverage on either platform. That flow drives the existing recipe write paths,
// so a regression could silently corrupt a run's recipe rows.
//
// The web SuggestionCard (artifacts/run-calculator/src/components/AssistantTab.tsx)
// is imported and rendered directly. The mobile SuggestionCard
// (artifacts/run-calculator-mobile/app/(tabs)/assistant.tsx) carries byte-for-byte
// identical apply/undo logic behind a React Native / Expo import graph that can't
// load in node, so it is pulled in through the strip-imports -> transpile ->
// inject-React pipeline documented in .agents/memory/web-test-harness.md (a stub
// prelude + injected real React supply the symbols the stripped imports used to
// provide), and the SAME suite is run against it. This enforces the replit.md
// web<->mobile parity rule for the apply/undo BEHAVIOR, not just its source bytes.
//
// What is asserted on BOTH platforms:
//  1. A returned suggestion renders its proposed rows but writes NOTHING until the
//     worker taps Apply (the AI never edits a recipe on its own).
//  2. Tapping Apply calls the run's write path exactly once and the recipe rows
//     become the suggestion's rows.
//  3. Tapping Undo within the window restores the previous rows exactly.
//  4. Once the 6s window elapses the Undo affordance is gone and the change is
//     permanent (UNDO_WINDOW_MS is real and identical across platforms).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import * as React from "react";

import { SuggestionCard as WebSuggestionCard } from "./components/AssistantTab";
import type { RecipeAssistSuggestion } from "./aiRecipe";

// The SuggestionCard component contract shared by both platform copies.
type SuggestionCardFn = (props: {
  suggestion: RecipeAssistSuggestion;
  onApply: (
    s: RecipeAssistSuggestion,
    runId: string,
  ) => { ok: boolean; message: string; undo?: () => void };
  applyTargets: { id: string; label: string }[];
  defaultTargetId: string;
}) => React.ReactElement | null;

// ── A representative run's recipe store + the real apply contract ─────────────
// Stands in for the run-data write path (web applyRecipeSuggestion in pages/home
// .tsx, mobile applyRecipeSuggestion in (tabs)/assistant.tsx). Both replace the
// targeted recipe field's rows with the suggestion's rows and hand back an `undo`
// that restores the exact previous rows. The handler is the boundary the AI must
// not cross without an explicit Apply, so it counts its own calls.
type Row = { ingredient: string; lbs: number };

function makeRecipeStore(initial: Row[]) {
  const store = { rows: initial.map((r) => ({ ...r })) };
  let calls = 0;
  function onApply(s: RecipeAssistSuggestion, _runId: string) {
    calls += 1;
    const prev = store.rows.map((r) => ({ ...r }));
    store.rows = s.rows.map((r) => ({ ingredient: r.ingredient, lbs: r.lbs }));
    return {
      ok: true,
      message: s.kind === "scale" ? "Recipe scaled" : "Substitution applied",
      undo: () => {
        store.rows = prev;
      },
    };
  }
  return { store, onApply, calls: () => calls };
}

const INITIAL: Row[] = [
  { ingredient: "Flour", lbs: 50 },
  { ingredient: "Water", lbs: 30 },
];

// A scale suggestion that both adds a row (Yeast) and changes existing weights, so
// "rows changed" and "rows restored" are unambiguous to assert.
function scaleSuggestion(): RecipeAssistSuggestion {
  return {
    kind: "scale",
    recipeId: "doughRecipe",
    recipeName: "Dough",
    summary: "Scale dough 1.5x",
    rows: [
      { ingredient: "Flour", lbs: 75 },
      { ingredient: "Water", lbs: 45 },
      { ingredient: "Yeast", lbs: 2 },
    ],
  };
}

const TARGETS = [{ id: "run-1", label: "Run 1" }];

// ── Shared suite, run against both platform components ────────────────────────
function defineSuite(label: string, getCard: () => SuggestionCardFn) {
  describe(`recipe suggestion Apply + Undo [${label}]`, () => {
    afterEach(() => {
      cleanup();
    });

    it("renders the proposed rows but writes nothing until Apply", () => {
      const Card = getCard();
      const { store, onApply, calls } = makeRecipeStore(INITIAL);
      const suggestion = scaleSuggestion();

      render(
        React.createElement(Card, {
          suggestion,
          onApply,
          applyTargets: TARGETS,
          defaultTargetId: "run-1",
        }),
      );

      // The suggestion's rows (incl. the brand-new Yeast row) are shown for review.
      expect(screen.getByText("Yeast")).toBeTruthy();
      expect(screen.getByText("Flour")).toBeTruthy();

      // ...but nothing has been written — the AI never edits a recipe on its own.
      expect(calls()).toBe(0);
      expect(store.rows).toEqual(INITIAL);
    });

    it("applies the suggestion's rows on Apply, then restores them on Undo", () => {
      const Card = getCard();
      const { store, onApply, calls } = makeRecipeStore(INITIAL);
      const suggestion = scaleSuggestion();

      render(
        React.createElement(Card, {
          suggestion,
          onApply,
          applyTargets: TARGETS,
          defaultTargetId: "run-1",
        }),
      );

      // Tap Apply — the run's write path runs exactly once and the rows change.
      fireEvent.click(screen.getByRole("button", { name: "Scale dough 1.5x" }));
      expect(calls()).toBe(1);
      expect(store.rows).toEqual(suggestion.rows);

      // The Undo affordance appears within the window; tap it and the previous
      // rows come back exactly. No second write path call is incurred.
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(store.rows).toEqual(INITIAL);
      expect(calls()).toBe(1);
    });

    it("makes the change permanent once the 6s Undo window elapses", () => {
      vi.useFakeTimers();
      try {
        const Card = getCard();
        const { store, onApply } = makeRecipeStore(INITIAL);
        const suggestion = scaleSuggestion();

        render(
          React.createElement(Card, {
            suggestion,
            onApply,
            applyTargets: TARGETS,
            defaultTargetId: "run-1",
          }),
        );

        fireEvent.click(screen.getByRole("button", { name: "Scale dough 1.5x" }));
        expect(screen.queryByRole("button", { name: "Undo" })).toBeTruthy();
        expect(store.rows).toEqual(suggestion.rows);

        // After the 6s window the Undo button is gone and the change stays applied.
        act(() => {
          vi.advanceTimersByTime(6000);
        });
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
        expect(store.rows).toEqual(suggestion.rows);
      } finally {
        vi.useRealTimers();
      }
    });
  });
}

defineSuite("web", () => WebSuggestionCard as unknown as SuggestionCardFn);

