// ── Source guard: mobile run-value writes must flow through the stamp funnel ─
//
// Mobile parity twin of runValueStampGuard.test.ts (web). The per-run LWW
// merge (server protectRunValues + both clients' receive guards) only keeps a
// value whose runValuesUpdatedAt stamp is strictly newer than the stored one.
// Mobile has ONE central stamping funnel: the change-watcher effect in
// context/RunContext.tsx diff-stamps every appState change via
// diffStampRunEdits (sync/mapping.ts). Any write path that mutates run values
// while BYPASSING that funnel pushes/persists values without a fresh stamp —
// they silently lose the next sync merge to a peer's stale stamped copy and
// the user's edit reverts (see .agents/memory/run-meta-lww.md).
//
// The funnel only sees state committed through setAppState (React re-render →
// watcher effect → diffStampRunEdits). So the bypass shapes on mobile are:
//   1. Assigning the stamp/baseline refs (runValuesUpdatedAtRef,
//      lastRunValsRef, editAttribPrimedRef) outside the funnel or the
//      remote-adoption merge — pre-seeding the baseline makes the next local
//      edit look unchanged and it never gets stamped.
//   2. Reassigning appStateRef.current to anything but the render mirror —
//      doPush reads appStateRef, so this pushes values the watcher never saw.
//   3. Mutating prev-state (or an appStateRef alias) IN PLACE — no new object
//      means no re-render, so the watcher (and its stamp) never fires, yet the
//      mutated object leaks into the next push/persist.
//   4. Calling persist/persistNow with state that was never committed via
//      setAppState — it lands in AsyncStorage unstamped, reloads as the
//      unprimed baseline, and the next sync pull clobbers it.
//   5. Writing the AsyncStorage state key directly outside the sanctioned
//      persist helpers / setAppState-committing load-rollover paths.
// Anything else is a violation. There is intentionally NO allowlist: fix the
// path (commit it through setAppState so the funnel stamps it) rather than
// exempting it.
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const MOBILE_ROOT = path.resolve(__dirname, "..", "..", "run-calculator-mobile");
const MOBILE_FILE = path.join(MOBILE_ROOT, "context", "RunContext.tsx");
const MAPPING_FILE = path.join("context", "sync", "mapping.ts");

// Refs whose assignment is only legitimate inside the funnel (diffStampRunEdits)
// or the remote-adoption merge (applyPayloadToState).
const STAMP_REFS = [
  "runValuesUpdatedAtRef.current",
  "lastRunValsRef.current",
  "editAttribPrimedRef.current",
];

const ARRAY_MUTATORS = new Set([
  "push",
  "pop",
  "splice",
  "shift",
  "unshift",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

type Site = {
  line: number;
  kind:
    | "stamp-ref-assign"
    | "app-state-mirror"
    | "in-place-mutation"
    | "persist-call"
    | "storage-write";
  enclosingName: string;
  verdict:
    | "funnel-stamped"
    | "remote-adopted"
    | "mirror"
    | "state-committed"
    | "persist-impl"
    | "VIOLATION";
  detail: string;
};

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (isFunctionLike(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

// Best-effort readable name, looking through wrappers like useCallback(...).
function functionName(fn: ts.FunctionLikeDeclaration): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return fn.name.getText();
  }
  let p: ts.Node | undefined = fn.parent;
  if (p && ts.isCallExpression(p)) p = p.parent; // useCallback(fn) → const name =
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText();
  return "<anonymous>";
}

// All calls anywhere under `root` whose callee is the bare identifier `name`.
function identifierCallsInside(root: ts.Node, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

// Is `node` lexically inside the ARGUMENTS of a call to bare identifier `name`
// (e.g. persist(next) inside a setAppState(prev => {...}) updater)?
function insideCallTo(node: ts.Node, name: string): boolean {
  let cur: ts.Node | undefined = node.parent;
  let prev: ts.Node = node;
  while (cur) {
    if (
      ts.isCallExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      cur.expression.text === name &&
      cur.arguments.some((a) => a === prev || a.getStart() <= node.getStart())
    ) {
      // node must be within one of the arguments, not the callee.
      if (cur.expression !== prev) return true;
    }
    prev = cur;
    cur = cur.parent;
  }
  return false;
}

// Does any function in the ancestor chain resolve to one of `names`?
function ancestorFunctionNamed(node: ts.Node, names: string[]): boolean {
  let fn = enclosingFunction(node);
  while (fn) {
    if (names.includes(functionName(fn))) return true;
    fn = enclosingFunction(fn);
  }
  return false;
}

// Root identifier of a (possibly chained) property/element access expression.
function rootIdentifier(expr: ts.Expression): string | undefined {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = cur.expression;
  }
  return ts.isIdentifier(cur) ? cur.text : undefined;
}

// Names declared anywhere in the file as `const X = appStateRef.current` —
// mutating through such an alias is mutating the pushed state in place.
function collectAppStateAliases(sf: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      n.initializer.getText() === "appStateRef.current"
    ) {
      aliases.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return aliases;
}

export function analyzeMobileSource(source: string, fileName = "RunContext.tsx"): Site[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: Site[] = [];
  const aliases = collectAppStateAliases(sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const encName = (n: ts.Node) => {
    const fn = enclosingFunction(n);
    return fn ? functionName(fn) : "<module scope>";
  };

  const visit = (n: ts.Node) => {
    // ── Assignments ──
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = n.left;
      const lhsText = lhs.getText();

      // Rule 1: stamp/baseline refs — only the funnel or the remote adoption.
      if (STAMP_REFS.includes(lhsText)) {
        const fn = enclosingFunction(n);
        if (fn && identifierCallsInside(fn, "diffStampRunEdits").length > 0) {
          sites.push({
            line: lineOf(n),
            kind: "stamp-ref-assign",
            enclosingName: encName(n),
            verdict: "funnel-stamped",
            detail: `${lhsText} assigned in the diffStampRunEdits funnel`,
          });
        } else if (fn && identifierCallsInside(fn, "applyPayloadToState").length > 0) {
          sites.push({
            line: lineOf(n),
            kind: "stamp-ref-assign",
            enclosingName: encName(n),
            verdict: "remote-adopted",
            detail: `${lhsText} assigned while adopting remote merge stamps (applyPayloadToState)`,
          });
        } else {
          sites.push({
            line: lineOf(n),
            kind: "stamp-ref-assign",
            enclosingName: encName(n),
            verdict: "VIOLATION",
            detail:
              `${lhsText} assigned outside the diffStampRunEdits funnel / applyPayloadToState ` +
              `adoption — this can suppress or corrupt per-run edit stamps`,
          });
        }
      }
      // Rule 2: appStateRef.current — only the render mirror.
      else if (lhsText === "appStateRef.current") {
        const rhsIsMirror = ts.isIdentifier(n.right) && n.right.text === "appState";
        sites.push({
          line: lineOf(n),
          kind: "app-state-mirror",
          enclosingName: encName(n),
          verdict: rhsIsMirror ? "mirror" : "VIOLATION",
          detail: rhsIsMirror
            ? "render mirror (appStateRef.current = appState)"
            : "appStateRef.current reassigned to non-mirror state — doPush would send values the change-watcher never stamped",
        });
      }
      // Rule 3: in-place mutation of prev-state / pushed state.
      else if (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
        const root = rootIdentifier(lhs);
        const throughAppStateRef =
          lhsText.startsWith("appStateRef.current.") || lhsText.startsWith("appStateRef.current[");
        if (root === "prev" || throughAppStateRef || (root !== undefined && aliases.has(root))) {
          sites.push({
            line: lineOf(n),
            kind: "in-place-mutation",
            enclosingName: encName(n),
            verdict: "VIOLATION",
            detail:
              `in-place mutation of ${lhsText} — no new state object means no re-render, ` +
              `so the change-watcher never diff-stamps this edit`,
          });
        }
      }
    }

    // Rule 3b: array mutators on prev-state / appStateRef / aliases.
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ARRAY_MUTATORS.has(n.expression.name.text)
    ) {
      const target = n.expression.expression;
      const targetText = target.getText();
      const root = rootIdentifier(target);
      if (
        root === "prev" ||
        targetText === "appStateRef.current" ||
        targetText.startsWith("appStateRef.current.") ||
        (root !== undefined && aliases.has(root) && targetText !== root)
      ) {
        sites.push({
          line: lineOf(n),
          kind: "in-place-mutation",
          enclosingName: encName(n),
          verdict: "VIOLATION",
          detail: `in-place array mutation ${targetText}.${n.expression.name.text}(…) on previous/pushed state`,
        });
      }
    }

    // Rule 4: persist/persistNow must carry state committed via setAppState.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "persist" || n.expression.text === "persistNow")
    ) {
      const fn = enclosingFunction(n);
      const committed =
        insideCallTo(n, "setAppState") ||
        (fn !== undefined && identifierCallsInside(fn, "setAppState").length > 0);
      sites.push({
        line: lineOf(n),
        kind: "persist-call",
        enclosingName: encName(n),
        verdict: committed ? "state-committed" : "VIOLATION",
        detail: committed
          ? `${n.expression.text}(…) alongside a setAppState commit`
          : `${n.expression.text}(…) with state never committed via setAppState — it reloads as an ` +
            `unprimed (unstamped) baseline and the next sync pull clobbers it`,
      });
    }

    // Rule 5: direct AsyncStorage.setItem(STORAGE_KEY, …) writes.
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText() === "AsyncStorage" &&
      n.expression.name.text === "setItem" &&
      n.arguments.length >= 1 &&
      n.arguments[0].getText() === "STORAGE_KEY"
    ) {
      const fn = enclosingFunction(n);
      if (ancestorFunctionNamed(n, ["persist", "persistNow"])) {
        sites.push({
          line: lineOf(n),
          kind: "storage-write",
          enclosingName: encName(n),
          verdict: "persist-impl",
          detail: "inside the sanctioned persist/persistNow helper",
        });
      } else if (fn !== undefined && identifierCallsInside(fn, "setAppState").length > 0) {
        sites.push({
          line: lineOf(n),
          kind: "storage-write",
          enclosingName: encName(n),
          verdict: "state-committed",
          detail: "direct STORAGE_KEY write alongside a setAppState commit (load/rollover path)",
        });
      } else {
        sites.push({
          line: lineOf(n),
          kind: "storage-write",
          enclosingName: encName(n),
          verdict: "VIOLATION",
          detail:
            "AsyncStorage.setItem(STORAGE_KEY, …) outside persist/persistNow and without a " +
            "setAppState commit — persisted state bypasses the stamp funnel",
        });
      }
    }

    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

const mobileSrc = fs.readFileSync(MOBILE_FILE, "utf8");
const mobileSites = analyzeMobileSource(mobileSrc);

describe("source guard: mobile run-value writes must flow through the diffStampRunEdits funnel", () => {
  it("no write path bypasses the stamp funnel", () => {
    const violations = mobileSites.filter((s) => s.verdict === "VIOLATION");
    const report = violations
      .map((s) => `  RunContext.tsx:${s.line} [${s.kind}] in ${s.enclosingName}() — ${s.detail}`)
      .join("\n");
    expect(
      violations,
      `Mobile run-value write(s) bypassing the central diffStampRunEdits funnel — these values ` +
        `will silently lose the per-run LWW sync merge to a peer's stale stamped copy ` +
        `(see .agents/memory/run-meta-lww.md).\n` +
        `Fix by committing the state through setAppState (so the change-watcher diff-stamps it), ` +
        `not by exempting the path:\n${report}`,
    ).toEqual([]);
  });

  it("the guard is not vacuous: it sees the funnel, the remote adoption, and the write surface", () => {
    // The funnel: the change-watcher assigns all three refs after diffStampRunEdits.
    const funnel = mobileSites.filter(
      (s) => s.kind === "stamp-ref-assign" && s.verdict === "funnel-stamped",
    );
    expect(funnel.length, "diffStampRunEdits funnel ref assignments").toBeGreaterThanOrEqual(3);
    // The remote adoption: commitRemote adopts merged stamps + reseeds the baseline.
    const adopted = mobileSites.filter(
      (s) => s.kind === "stamp-ref-assign" && s.verdict === "remote-adopted",
    );
    expect(adopted.length, "applyPayloadToState remote-stamp adoption").toBeGreaterThanOrEqual(3);
    // The render mirror feeding doPush.
    expect(
      mobileSites.filter((s) => s.kind === "app-state-mirror" && s.verdict === "mirror").length,
      "appStateRef render mirror",
    ).toBeGreaterThanOrEqual(1);
    // The file still has a meaningful number of persist call sites overall.
    expect(
      mobileSites.filter((s) => s.kind === "persist-call").length,
      "persist/persistNow call sites",
    ).toBeGreaterThanOrEqual(40);
    // Sanctioned direct storage writes: persist + persistNow impls, and the
    // load-rollover paths that commit via setAppState in the same function.
    expect(
      mobileSites.filter((s) => s.kind === "storage-write").length,
      "STORAGE_KEY write sites",
    ).toBeGreaterThanOrEqual(4);
    // If diffStampRunEdits ever disappears from the source, the funnel checks
    // above would go 0 — but assert the call is present explicitly too.
    expect(/\bdiffStampRunEdits\s*\(/.test(mobileSrc), "funnel call present").toBe(true);
  });

  it("the stamp write surface stays inside RunContext.tsx + sync/mapping.ts", () => {
    // If another mobile module starts writing the AsyncStorage state key or
    // touching the stamp refs/funnel, it must be added to this guard first.
    const offenders: string[] = [];
    const SKIP_DIRS = new Set(["node_modules", ".expo", "assets", "dist", "build"]);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(MOBILE_ROOT, full);
        if (rel === path.join("context", "RunContext.tsx")) continue;
        const text = fs.readFileSync(full, "utf8");
        if (/run-calc-mobile-v2/.test(text) || /\brunValuesUpdatedAtRef\b/.test(text)) {
          offenders.push(rel);
        }
        if (rel !== MAPPING_FILE && /\bdiffStampRunEdits\b/.test(text)) {
          offenders.push(rel);
        }
      }
    };
    walk(MOBILE_ROOT);
    expect(
      offenders,
      "mobile stamp/storage surface used outside RunContext.tsx + sync/mapping.ts — extend " +
        "mobileRunValueStampGuard.test.ts to cover it",
    ).toEqual([]);
  });
});

describe("source guard self-test: the analyzer actually detects the mobile bug class", () => {
  it("flags a stamp-map assignment outside the funnel (stamp corruption)", () => {
    const sites = analyzeMobileSource(`
      function bad(id: string) {
        runValuesUpdatedAtRef.current = { ...runValuesUpdatedAtRef.current, [id]: 0 };
        schedulePush();
      }
    `);
    expect(sites.map((s) => s.verdict)).toEqual(["VIOLATION"]);
  });

  it("flags a baseline pre-seed outside the funnel (edit suppression)", () => {
    const sites = analyzeMobileSource(`
      function bad(nextVals: Record<string, string>) {
        lastRunValsRef.current = nextVals; // watcher now sees "no diff" → no stamp
        setAppState((prev) => ({ ...prev }));
      }
    `);
    expect(sites.filter((s) => s.kind === "stamp-ref-assign").map((s) => s.verdict)).toEqual([
      "VIOLATION",
    ]);
  });

  it("accepts the legitimate funnel shape", () => {
    const sites = analyzeMobileSource(`
      function watcher(now: number) {
        const { updatedAt } = diffStampRunEdits(nextVals, lastRunValsRef.current, primed, now, runValuesUpdatedAtRef.current, emptyStr);
        runValuesUpdatedAtRef.current = updatedAt;
        lastRunValsRef.current = nextVals;
        editAttribPrimedRef.current = true;
        schedulePush();
      }
    `);
    const stamps = sites.filter((s) => s.kind === "stamp-ref-assign");
    expect(stamps).toHaveLength(3);
    expect(stamps.every((s) => s.verdict === "funnel-stamped")).toBe(true);
  });

  it("accepts the remote-adoption shape (commitRemote)", () => {
    const sites = analyzeMobileSource(`
      const commitRemote = (payload: any) => {
        setAppState((prev) => {
          const { patch, mergedUpdatedAt } = applyPayloadToState(payload, prev, runValuesUpdatedAtRef.current);
          runValuesUpdatedAtRef.current = mergedUpdatedAt;
          const next = { ...prev, ...patch };
          lastRunValsRef.current = seed(next);
          editAttribPrimedRef.current = true;
          persistNow(next);
          return next;
        });
      };
    `);
    const stamps = sites.filter((s) => s.kind === "stamp-ref-assign");
    expect(stamps).toHaveLength(3);
    expect(stamps.every((s) => s.verdict === "remote-adopted")).toBe(true);
    expect(sites.filter((s) => s.kind === "persist-call").map((s) => s.verdict)).toEqual([
      "state-committed",
    ]);
  });

  it("flags an in-place mutation of prev-state inside a setAppState updater", () => {
    const sites = analyzeMobileSource(`
      function bad(cases: number) {
        setAppState((prev) => {
          prev.runs[prev.currentIndex].settings.casesNeeded = cases; // same reference → no re-render
          return prev;
        });
      }
    `);
    expect(sites.map((s) => s.kind)).toEqual(["in-place-mutation"]);
    expect(sites[0].verdict).toBe("VIOLATION");
  });

  it("flags in-place mutation through an appStateRef alias (incl. array mutators)", () => {
    const sites = analyzeMobileSource(`
      function bad() {
        const cur = appStateRef.current;
        cur.shiftNotes = "oops";
        cur.runs.push(makeNewRun());
        persistNow(cur);
      }
    `);
    const kinds = sites.map((s) => s.kind).sort();
    expect(kinds).toEqual(["in-place-mutation", "in-place-mutation", "persist-call"]);
    expect(sites.every((s) => s.verdict === "VIOLATION")).toBe(true);
  });

  it("flags persist of state never committed via setAppState", () => {
    const sites = analyzeMobileSource(`
      function bad(runId: string) {
        const next = { ...appStateRef.current, shiftNotes: "edited" };
        persistNow(next); // AsyncStorage only — reloads as unprimed baseline, sync clobbers it
      }
    `);
    expect(sites.map((s) => s.verdict)).toEqual(["VIOLATION"]);
  });

  it("accepts persist inside a setAppState updater and the rollover shape (setAppState + persistNow in the same function)", () => {
    const sites = analyzeMobileSource(`
      const addRun = () => {
        setAppState((prev) => {
          const next = { ...prev, runs: [...prev.runs, makeNewRun()] };
          persist(next);
          return next;
        });
      };
      const rolloverDay = () => {
        const next = buildNextDay(appStateRef.current);
        setAppState(next);
        persistNow(next);
      };
    `);
    const persists = sites.filter((s) => s.kind === "persist-call");
    expect(persists).toHaveLength(2);
    expect(persists.every((s) => s.verdict === "state-committed")).toBe(true);
  });

  it("flags a non-mirror reassignment of appStateRef.current", () => {
    const sites = analyzeMobileSource(`
      function bad(next: AppState) {
        appStateRef.current = next; // push source mutated without the watcher seeing it
        schedulePush();
      }
    `);
    expect(sites.map((s) => s.verdict)).toEqual(["VIOLATION"]);
  });

  it("accepts the render mirror", () => {
    const sites = analyzeMobileSource(`
      const appStateRef = useRef(appState);
      appStateRef.current = appState;
    `);
    expect(sites.map((s) => s.verdict)).toEqual(["mirror"]);
  });

  it("flags a raw STORAGE_KEY write with no setAppState commit", () => {
    const sites = analyzeMobileSource(`
      function bad(next: AppState) {
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    `);
    expect(sites.map((s) => s.verdict)).toEqual(["VIOLATION"]);
  });

  it("accepts STORAGE_KEY writes in the persist helpers and the load-rollover commit", () => {
    const sites = analyzeMobileSource(`
      const persist = useCallback((state: AppState) => {
        saveRef.current = setTimeout(() => {
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }, 400);
      }, []);
      function loadRollover(next: AppState) {
        setAppState(next);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    `);
    const writes = sites.filter((s) => s.kind === "storage-write");
    expect(writes.map((s) => s.verdict).sort()).toEqual(["persist-impl", "state-committed"]);
  });

  it("does NOT let a funnel call in an OUTER function excuse an unstamped inner assignment", () => {
    const sites = analyzeMobileSource(`
      function outer(now: number) {
        const { updatedAt } = diffStampRunEdits(a, b, true, now, c, d);
        runValuesUpdatedAtRef.current = updatedAt;
        const later = () => {
          runValuesUpdatedAtRef.current = {}; // wipes stamps outside the funnel
        };
        return later;
      }
    `);
    const stamps = sites.filter((s) => s.kind === "stamp-ref-assign");
    expect(stamps).toHaveLength(2);
    expect(stamps.map((s) => s.verdict).sort()).toEqual(["VIOLATION", "funnel-stamped"]);
  });
});
