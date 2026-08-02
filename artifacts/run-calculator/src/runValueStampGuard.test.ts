// ── Source guard: every run-value WRITE in home.tsx must stamp itself ───────
//
// The per-run LWW merge (server protectRunValues + both clients' receive
// guards) only keeps a value whose runValuesUpdatedAt stamp is strictly newer
// than the stored one. A code path that mutates run values via saveRunValues()
// WITHOUT calling markRunValuesUpdated() (or adopting remote stamps via
// saveRunValuesUpdated()) writes a value that silently loses to a peer's stale
// stamped copy on the next sync merge — the "I changed it and it reverted"
// data loss. This bug class has shipped before (the re-import case-update
// accept dialog), so this lint-style guard fails the build whenever any
// FUTURE saveRunValues call site bypasses stamping.
//
// Rules enforced per saveRunValues() call site (via the TypeScript AST, so
// comments/strings/JSX can't confuse it):
//   1. The innermost enclosing function contains markRunValuesUpdated(…)
//      → OK (locally stamped edit), or
//   2. it contains saveRunValuesUpdated(…)
//      → OK (adopting remote/merged stamps, e.g. sync receive & rollover
//        pull-up — server-sourced values must NOT be stamped with local time), or
//   3. the call is a pure FLUSH of the already-stamped live form: the second
//      argument is form.getValues() (or a variable assigned from it) AND no
//      form.setValue(…) mutated the form earlier in the same function
//      → OK (the values were stamped by the autosave watcher when edited).
// Anything else is a violation. There is intentionally NO allowlist: fix the
// path (stamp it) rather than exempting it.
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");

type CallSite = {
  line: number;
  enclosingName: string;
  verdict: "stamped-local" | "stamped-remote" | "flush" | "VIOLATION";
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

// Best-effort readable name for error messages.
function functionName(fn: ts.FunctionLikeDeclaration): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return fn.name.getText();
  }
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText();
  return "<anonymous>";
}

// Does `expr` read the live form without mutating it? (form.getValues(...))
function isFormGetValuesCall(expr: ts.Expression): boolean {
  return (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.expression.getText() === "form" &&
    expr.expression.name.text === "getValues"
  );
}

function callsInside(root: ts.Node, calleeText: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === calleeText) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

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

// Is `name` declared in `fn` as `const name = form.getValues(...)`, unmodified?
function isDeclaredAsFormSnapshot(fn: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      isFormGetValuesCall(n.initializer)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

function analyzeSource(source: string, fileName = "home.tsx"): CallSite[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: CallSite[] = [];

  for (const call of identifierCallsInside(sf, "saveRunValues")) {
    const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    const fn = enclosingFunction(call);
    if (!fn) {
      sites.push({
        line,
        enclosingName: "<module scope>",
        verdict: "VIOLATION",
        detail: "saveRunValues called outside any function — cannot verify stamping",
      });
      continue;
    }
    const name = functionName(fn);

    // Rule 1/2: a stamp call anywhere in the same (innermost) function.
    if (identifierCallsInside(fn, "markRunValuesUpdated").length > 0) {
      sites.push({ line, enclosingName: name, verdict: "stamped-local", detail: "markRunValuesUpdated present" });
      continue;
    }
    if (identifierCallsInside(fn, "saveRunValuesUpdated").length > 0) {
      sites.push({ line, enclosingName: name, verdict: "stamped-remote", detail: "saveRunValuesUpdated present" });
      continue;
    }

    // Rule 3: pure flush of the live form (already stamped by the autosave
    // watcher when the user edited it). Disqualified if the same function
    // mutated the form via form.setValue BEFORE this save — that's a bypass
    // edit whose value the autosave guard will skip (stored === form).
    const valueArg = call.arguments[1];
    const setValueBefore = callsInside(fn, "form.setValue").some(
      (c) => c.getStart(sf) < call.getStart(sf),
    );
    const isFlushArg =
      valueArg != null &&
      (isFormGetValuesCall(valueArg) ||
        (ts.isIdentifier(valueArg) && isDeclaredAsFormSnapshot(fn, valueArg.text)));
    if (isFlushArg && !setValueBefore) {
      sites.push({ line, enclosingName: name, verdict: "flush", detail: "unmodified form.getValues() snapshot" });
      continue;
    }

    sites.push({
      line,
      enclosingName: name,
      verdict: "VIOLATION",
      detail: setValueBefore
        ? "form.setValue mutation followed by an unstamped save (the autosave watcher will skip it)"
        : "run values mutated and saved without markRunValuesUpdated / saveRunValuesUpdated in the same function",
    });
  }
  return sites;
}

const homeSrc = fs.readFileSync(HOME_FILE, "utf8");
const homeSites = analyzeSource(homeSrc);

describe("source guard: run-value writes in home.tsx must stamp before they sync", () => {
  it("every saveRunValues call site stamps (markRunValuesUpdated / saveRunValuesUpdated) or is a pure form flush", () => {
    const violations = homeSites.filter((s) => s.verdict === "VIOLATION");
    const report = violations
      .map((s) => `  home.tsx:${s.line} in ${s.enclosingName}() — ${s.detail}`)
      .join("\n");
    expect(
      violations,
      `Unstamped run-value write(s) found — these values will silently lose the per-run LWW ` +
        `sync merge to a peer's stale stamped copy (see .agents/memory/run-meta-lww.md).\n` +
        `Fix by calling markRunValuesUpdated(<runId>) (+ lastLocalEditRef) in the same function ` +
        `for local edits, or saveRunValuesUpdated(...) when adopting server-sourced stamps:\n${report}`,
    ).toEqual([]);
  });

  it("the guard is not vacuous: it sees the known bypass-prone paths", () => {
    // If a refactor renames/moves these paths the guard must be re-pointed,
    // not silently skipped. These are the historical bypass writes.
    const byName = (n: string) => homeSites.filter((s) => s.enclosingName === n);
    expect(byName("applyCaseUpdateChoices").length, "re-import case-update accept").toBeGreaterThan(0);
    expect(byName("writeCases").length, "voice/optimize set_run_target").toBeGreaterThan(0);
    expect(byName("writeProgress").length, "voice setRunProgress").toBeGreaterThan(0);
    expect(byName("renameDoughIngredient").length, "master-data rename write").toBeGreaterThan(0);
    expect(byName("updateDrainingRunValues").length, "draining-run write").toBeGreaterThan(0);
    expect(byName("copyRun").length, "copy-run write").toBeGreaterThan(0);
    // Rollover pull-up + sync receive adopt REMOTE stamps rather than local ones.
    expect(homeSites.filter((s) => s.verdict === "stamped-remote").length).toBeGreaterThanOrEqual(2);
    // And the file still has a meaningful number of write sites overall.
    expect(homeSites.length).toBeGreaterThanOrEqual(20);
  });

  it("saveRunValues is only written from home.tsx (no unguarded write surface elsewhere)", () => {
    // The guard is scoped to home.tsx; if another app module starts importing
    // the writer, it must be added to this guard first.
    const srcDir = __dirname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = path.relative(srcDir, full);
        // contexts/LiveRunContext.tsx: pre-seeds next-run dough counters when the
        // press finishes; the write is immediately followed by markRunValuesUpdated.
        if (
          rel === path.join("pages", "home.tsx") ||
          rel === "storage.ts" ||
          rel === path.join("contexts", "LiveRunContext.tsx")
        ) continue;
        const text = fs.readFileSync(full, "utf8");
        if (/\bsaveRunValues\b/.test(text)) offenders.push(rel);
      }
    };
    walk(srcDir);
    expect(
      offenders,
      "saveRunValues used outside home.tsx/storage.ts — extend runValueStampGuard.test.ts to cover it",
    ).toEqual([]);
  });
});

describe("source guard self-test: the analyzer actually detects the bug class", () => {
  it("flags an unstamped object-literal mutation before schedulePush", () => {
    const sites = analyzeSource(`
      function bad(runId: string) {
        const vals = loadRunValues(runId);
        saveRunValues(runId, { ...vals, casesNeeded: 5 });
        schedulePush(dayStateRef.current, 0);
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("VIOLATION");
  });

  it("flags a form.setValue mutation flushed without a stamp (the case-update bug shape)", () => {
    const sites = analyzeSource(`
      function bad() {
        form.setValue("casesNeeded", 5, { shouldDirty: true });
        saveRunValues(currentRunId, form.getValues());
        schedulePush(dayStateRef.current, 0);
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("VIOLATION");
  });

  it("accepts the same paths once they stamp", () => {
    const sites = analyzeSource(`
      function good(runId: string) {
        const vals = loadRunValues(runId);
        saveRunValues(runId, { ...vals, casesNeeded: 5 });
        markRunValuesUpdated(runId, Date.now());
        schedulePush(dayStateRef.current, 0);
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("stamped-local");
  });

  it("accepts a pure flush of the already-stamped live form", () => {
    const sites = analyzeSource(`
      function switchAway() {
        const cur = form.getValues();
        saveRunValues(currentRunId, cur);
        schedulePush(dayStateRef.current, 0);
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("flush");
  });

  it("accepts remote-stamp adoption (sync receive / rollover pull-up shape)", () => {
    const sites = analyzeSource(`
      function pullUp(payload: any) {
        for (const [id, vals] of Object.entries(payload.runValues ?? {})) {
          saveRunValues(id, vals as FormValues);
        }
        saveRunValuesUpdated(payload.runValuesUpdatedAt ?? {});
        schedulePush(dayStateRef.current, 0);
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("stamped-remote");
  });

  it("does NOT let a stamp in an OUTER function excuse an unstamped inner write path", () => {
    const sites = analyzeSource(`
      function outer(runId: string) {
        markRunValuesUpdated(runId, Date.now());
        const laterCallback = () => {
          const vals = loadRunValues(runId);
          saveRunValues(runId, { ...vals, casesNeeded: 9 });
          schedulePush(dayStateRef.current, 0);
        };
        return laterCallback;
      }
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe("VIOLATION");
  });
});
