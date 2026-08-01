// @vitest-environment jsdom
//
// Mobile counterpart of specSheetWarningsCallout.test.tsx: import-time
// flavor-correction warnings saved on a spec sheet snapshot
// (ParsedSpecImport.warnings) must stay visible when a manager re-opens the
// sheet later in the mobile Spec Sheet Cross-Reference section
// (artifacts/run-calculator-mobile/app/master-data.tsx). A refactor there could
// silently hide corrections for managers reviewing older sheets on mobile only.
// Legacy snapshots (no warnings field) must render with NO callout.
//
// The mobile SpecSheetWarningsCallout lives behind a React Native / Expo import
// graph that can't load in node, so it is pulled in through the strip-imports
// -> transpile -> inject-React pipeline documented in
// .agents/memory/web-test-harness.md (a stub prelude + injected real React
// supply the symbols the stripped imports used to provide).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import type { SpecImportWarning } from "@workspace/spec-import";

// The mobile SavedSpecSheet shape (context/savedSpecSheets.ts), narrowed to
// what the callout reads. `data` is loose on purpose so legacy snapshots
// without a warnings field can be expressed.
type SheetLike = {
  id: number;
  label: string;
  createdAt: number;
  data: { warnings?: SpecImportWarning[] };
};

type CalloutFn = (props: {
  sheet: SheetLike;
  expanded: boolean;
  onToggle: () => void;
  colors: Record<string, string>;
}) => React.ReactElement | null;

// ── Mobile component loader (strip-imports -> transpile-to-CJS -> evaluate) ──
const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(here, "../../../_archived/mobile/app/master-data.tsx");

// Stubs evaluated in the module scope. React is injected separately so the
// component shares this test's React instance. Only module-eval-time symbols
// (StyleSheet.create + FONTS at the bottom styles block) and the handful the
// callout renders with are stubbed; everything else lives inside functions
// this test never calls, so it stays a harmless free identifier.
const STUB_PRELUDE = `
const FONTS = new Proxy({}, { get: () => "System" });
const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1 };
const View = (p) =>
  React.createElement("div", { "data-testid": p && p.testID }, p && p.children);
const Text = (p) => React.createElement("span", null, p && p.children);
const Pressable = (p) =>
  React.createElement(
    "button",
    { onClick: p && p.onPress, "data-testid": p && p.testID },
    p && p.children,
  );
const Feather = () => null;
`;

function loadMobileCallout(): CalloutFn {
  const ts = require("typescript") as typeof import("typescript");
  const raw = fs.readFileSync(MOBILE_FILE, "utf8");
  // Drop every `import ... from "...";` (incl. multiline + `import type`).
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
  const mod: { SpecSheetWarningsCallout?: CalloutFn } = {};
  factory(mod, () => ({}), React);
  if (!mod.SpecSheetWarningsCallout) {
    throw new Error("mobile SpecSheetWarningsCallout export not found");
  }
  return mod.SpecSheetWarningsCallout;
}

let MobileCallout: CalloutFn;

beforeAll(() => {
  MobileCallout = loadMobileCallout();
});

afterEach(() => cleanup());

// Matches how master-data.tsx uses the callout: the screen owns the
// expanded-ids Set and hands the component `expanded` + `onToggle`.
function SheetCardHarness({ sheets }: { sheets: SheetLike[] }) {
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());
  return (
    <div>
      {sheets.map((s) => (
        <div key={s.id} data-testid={`spec-sheet-${s.id}`}>
          <MobileCallout
            sheet={s}
            expanded={expandedIds.has(s.id)}
            onToggle={() =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(s.id)) next.delete(s.id);
                else next.add(s.id);
                return next;
              })
            }
            colors={{ warning: "#f59e0b", foreground: "#111" }}
          />
        </div>
      ))}
    </div>
  );
}

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

function makeSheet(id: number, data: { warnings?: SpecImportWarning[] }): SheetLike {
  return {
    id,
    label: `Spec sheet ${id}`,
    createdAt: Date.UTC(2026, 5, 1) + id,
    data,
  };
}

describe("mobile saved spec sheet flavor-correction callout", () => {
  it("shows the amber callout and expands to list each brand — flavor + message", () => {
    render(<SheetCardHarness sheets={[makeSheet(1, { warnings: WARNINGS })]} />);

    const callout = screen.getByTestId("spec-sheet-warnings-1");
    expect(callout).toBeTruthy();
    expect(callout.textContent).toContain("2 items were corrected or flagged at import");

    // Collapsed by default: individual warning details are not visible yet.
    expect(screen.queryByText(/Tony's — Pepperoni/)).toBeNull();

    // Expand and verify every warning row: brand — flavor plus its message.
    fireEvent.click(screen.getByTestId("button-spec-sheet-warnings-1"));
    for (const w of WARNINGS) {
      expect(screen.getByText(`${w.brand} — ${w.flavor}`)).toBeTruthy();
      expect(screen.getByText(w.message)).toBeTruthy();
    }

    // Collapses again on a second click (details hidden, header stays).
    fireEvent.click(screen.getByTestId("button-spec-sheet-warnings-1"));
    expect(screen.queryByText(`${WARNINGS[0].brand} — ${WARNINGS[0].flavor}`)).toBeNull();
    expect(screen.getByTestId("spec-sheet-warnings-1")).toBeTruthy();
  });

  it("uses singular wording for a single warning", () => {
    render(<SheetCardHarness sheets={[makeSheet(3, { warnings: [WARNINGS[0]] })]} />);

    const callout = screen.getByTestId("spec-sheet-warnings-3");
    expect(callout.textContent).toContain("1 item was corrected or flagged at import");
  });

  it("shows no callout for legacy snapshots without warnings", () => {
    render(
      <SheetCardHarness
        sheets={[
          // Legacy snapshot: no warnings field at all.
          makeSheet(5, {}),
          // Explicit empty warnings array must also render nothing.
          makeSheet(6, { warnings: [] }),
        ]}
      />,
    );

    // Both sheet cards render…
    expect(screen.getByTestId("spec-sheet-5")).toBeTruthy();
    expect(screen.getByTestId("spec-sheet-6")).toBeTruthy();
    // …but neither shows the amber callout.
    expect(screen.queryByTestId("spec-sheet-warnings-5")).toBeNull();
    expect(screen.queryByTestId("spec-sheet-warnings-6")).toBeNull();
    expect(screen.queryByText(/corrected or flagged at import/)).toBeNull();
  });

  it("shows an independent callout per sheet when several sheets carry warnings", () => {
    render(
      <SheetCardHarness
        sheets={[
          makeSheet(7, { warnings: [WARNINGS[0]] }),
          makeSheet(8, { warnings: [WARNINGS[1]] }),
          makeSheet(9, {}),
        ]}
      />,
    );

    expect(screen.getByTestId("spec-sheet-warnings-7")).toBeTruthy();
    expect(screen.getByTestId("spec-sheet-warnings-8")).toBeTruthy();
    expect(screen.queryByTestId("spec-sheet-warnings-9")).toBeNull();

    // Expanding one sheet's callout must not expand the other's.
    fireEvent.click(screen.getByTestId("button-spec-sheet-warnings-7"));
    expect(screen.getByText(`${WARNINGS[0].brand} — ${WARNINGS[0].flavor}`)).toBeTruthy();
    expect(screen.queryByText(`${WARNINGS[1].brand} — ${WARNINGS[1].flavor}`)).toBeNull();
  });
});
