// Regression guard: import-time flavor-correction warnings saved on a spec
// sheet snapshot (ParsedSpecImport.warnings) must stay visible when a manager
// re-opens the sheet later in the Spec Sheet Cross-Reference panel. A silent
// regression here would hide corrections managers rely on when reviewing older
// sheets. Legacy snapshots (no warnings field) must render with NO callout.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedSpecSheet } from "./savedSpecSheets";
import type { ParsedSpecImport, SpecImportWarning } from "@workspace/spec-import";

const fetchSavedSpecSheetsMock = vi.fn<() => Promise<SavedSpecSheet[]>>();

vi.mock("@/savedSpecSheets", async () => {
  const actual = await vi.importActual<typeof import("./savedSpecSheets")>("./savedSpecSheets");
  return {
    ...actual,
    fetchSavedSpecSheets: (...args: unknown[]) =>
      (fetchSavedSpecSheetsMock as unknown as (...a: unknown[]) => Promise<SavedSpecSheet[]>)(
        ...args,
      ),
    reconcileSpecSheet: vi.fn(),
    deleteSpecSheet: vi.fn(),
    loadCurrentReconcileRecipes: vi.fn(() => []),
    loadCurrentReconcileProfiles: vi.fn(() => []),
    currentReconcileProfile: vi.fn(() => null),
  };
});

import SpecReconcilePanel from "./components/SpecReconcilePanel";

const WARNINGS: SpecImportWarning[] = [
  {
    brand: "Tony's",
    flavor: "Pepperoni",
    message: 'Flavor name "Peperoni" was corrected to "Pepperoni".',
  },
  {
    brand: "Red Baron",
    flavor: "Four Cheese",
    message: "Flavor name not found on the sheet; kept as imported.",
  },
];

function makeSheet(id: number, data: Partial<ParsedSpecImport>): SavedSpecSheet {
  return {
    id,
    label: `Spec sheet ${id}`,
    sourceKey: `sheet-${id}`,
    createdAt: Date.UTC(2026, 5, 1) + id,
    data: data as ParsedSpecImport,
  };
}

beforeEach(() => {
  fetchSavedSpecSheetsMock.mockReset();
});

afterEach(() => cleanup());

describe("saved spec sheet flavor-correction callout", () => {
  it("shows the amber callout and expands to list each brand — flavor + message", async () => {
    fetchSavedSpecSheetsMock.mockResolvedValue([
      makeSheet(1, { profiles: [], recipes: [], warnings: WARNINGS }),
    ]);
    const user = userEvent.setup();
    render(<SpecReconcilePanel />);

    // Callout renders once the sheet list loads.
    const callout = await screen.findByTestId("spec-sheet-warnings-1");
    expect(callout).toBeTruthy();
    expect(callout.textContent).toContain("2 items were corrected or flagged at import");

    // Collapsed by default: individual warning details are not visible yet.
    expect(screen.queryByText(/Tony's — Pepperoni/)).toBeNull();

    // Expand and verify every warning row: brand — flavor plus its message.
    await user.click(screen.getByTestId("button-spec-sheet-warnings-1"));
    for (const w of WARNINGS) {
      expect(screen.getByText(`${w.brand} — ${w.flavor}`)).toBeTruthy();
      expect(screen.getByText(w.message)).toBeTruthy();
    }

    // Collapses again on a second click (details hidden, header stays).
    await user.click(screen.getByTestId("button-spec-sheet-warnings-1"));
    expect(screen.queryByText(`${WARNINGS[0].brand} — ${WARNINGS[0].flavor}`)).toBeNull();
    expect(screen.getByTestId("spec-sheet-warnings-1")).toBeTruthy();
  });

  it("uses singular wording for a single warning", async () => {
    fetchSavedSpecSheetsMock.mockResolvedValue([
      makeSheet(3, { profiles: [], recipes: [], warnings: [WARNINGS[0]] }),
    ]);
    render(<SpecReconcilePanel />);

    const callout = await screen.findByTestId("spec-sheet-warnings-3");
    expect(callout.textContent).toContain("1 item was corrected or flagged at import");
  });

  it("shows no callout for legacy snapshots without warnings", async () => {
    fetchSavedSpecSheetsMock.mockResolvedValue([
      // Legacy snapshot: no warnings field at all.
      makeSheet(5, { profiles: [], recipes: [] }),
      // Explicit empty warnings array must also render nothing.
      makeSheet(6, { profiles: [], recipes: [], warnings: [] }),
    ]);
    render(<SpecReconcilePanel />);

    // Both sheets render…
    expect(await screen.findByTestId("spec-sheet-5")).toBeTruthy();
    expect(screen.getByTestId("spec-sheet-6")).toBeTruthy();
    // …but neither shows the amber callout.
    expect(screen.queryByTestId("spec-sheet-warnings-5")).toBeNull();
    expect(screen.queryByTestId("spec-sheet-warnings-6")).toBeNull();
    expect(screen.queryByText(/corrected or flagged at import/)).toBeNull();
  });

  it("shows an independent callout per sheet when several sheets carry warnings", async () => {
    fetchSavedSpecSheetsMock.mockResolvedValue([
      makeSheet(7, { profiles: [], recipes: [], warnings: [WARNINGS[0]] }),
      makeSheet(8, { profiles: [], recipes: [], warnings: [WARNINGS[1]] }),
      makeSheet(9, { profiles: [], recipes: [] }),
    ]);
    const user = userEvent.setup();
    render(<SpecReconcilePanel />);

    expect(await screen.findByTestId("spec-sheet-warnings-7")).toBeTruthy();
    expect(screen.getByTestId("spec-sheet-warnings-8")).toBeTruthy();
    expect(screen.queryByTestId("spec-sheet-warnings-9")).toBeNull();

    // Expanding one sheet's callout must not expand the other's.
    await user.click(screen.getByTestId("button-spec-sheet-warnings-7"));
    expect(screen.getByText(`${WARNINGS[0].brand} — ${WARNINGS[0].flavor}`)).toBeTruthy();
    expect(screen.queryByText(`${WARNINGS[1].brand} — ${WARNINGS[1].flavor}`)).toBeNull();
  });
});
