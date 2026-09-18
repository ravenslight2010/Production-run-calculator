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
import ts from "@workspace/typescript-api-v6";
import { describe, expect, it } from "vitest";

const HOME_FILE = path.join(__dirname, "pages", "home.tsx");
const FORM_LIFECYCLE_FILE = path.join(__dirname, "hooks", "useHomeFormLifecycle.ts");
const PACKAGING_MANAGER_FILE = path.join(__dirname, "packagingManager.ts");
const LIVE_STATIONS_DIR = path.join(__dirname, "components", "live-stations");
const LIVE_TABS_SUPPORT_FILE = path.join(__dirname, "pages", "liveTabsSupport.tsx");

// Extracted live tabs may read a persisted run value for display, but the
// orchestration layer owns raw run-value writes. In particular, keeping
// saveRunValues imports out of these modules prevents copied import blocks from
// being mistaken for new persistence call sites by the broader source guard.
const RUN_VALUE_WRITERS = new Set(["saveRunValues", "saveRunValuesUpdated"]);
const RUN_VALUE_READERS = new Set([
  "loadRunValues",
  "loadRunValuesUpdated",
  "subscribeRunValuesWrites",
]);

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

type LiveTabPersistenceIssue = {
  file: string;
  line: number;
  kind: "writer-import" | "unused-reader-import";
  name: string;
};

function isRunPersistenceModule(specifier: string): boolean {
  return specifier.endsWith("/storage") || specifier.endsWith("/adapters/browserRunPersistence");
}

function identifierReferenceCount(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    // Import declarations are the binding site, not a use of the local name.
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === name) count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function inspectLiveTabPersistenceSource(source: string, file: string): LiveTabPersistenceIssue[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const issues: LiveTabPersistenceIssue[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier) || !isRunPersistenceModule(moduleSpecifier.text)) continue;
    if (!statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;

    for (const specifier of statement.importClause.namedBindings.elements) {
      const importedName = (specifier.propertyName ?? specifier.name).text;
      const localName = specifier.name.text;
      const line = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1;
      if (RUN_VALUE_WRITERS.has(importedName)) {
        issues.push({ file: path.relative(__dirname, file), line, kind: "writer-import", name: importedName });
      } else if (RUN_VALUE_READERS.has(importedName) && identifierReferenceCount(sourceFile, localName) === 0) {
        issues.push({ file: path.relative(__dirname, file), line, kind: "unused-reader-import", name: importedName });
      }
    }
  }

  return issues;
}

function inspectLiveTabPersistenceImports(file: string): LiveTabPersistenceIssue[] {
  return inspectLiveTabPersistenceSource(fs.readFileSync(file, "utf8"), file);
}

function liveTabSourceFiles(): string[] {
  const files: string[] = [LIVE_TABS_SUPPORT_FILE];
  for (const entry of fs.readdirSync(LIVE_STATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(path.join(LIVE_STATIONS_DIR, entry.name));
  }
  return files;
}

const liveTabPersistenceIssues = liveTabSourceFiles().flatMap(inspectLiveTabPersistenceImports);

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
const formLifecycleSites = analyzeSource(
  fs.readFileSync(FORM_LIFECYCLE_FILE, "utf8"),
  "useHomeFormLifecycle.ts",
);
const packagingManagerSites = analyzeSource(
  fs.readFileSync(PACKAGING_MANAGER_FILE, "utf8"),
  "packagingManager.ts",
);

describe("source guard: run-value writes in home.tsx must stamp before they sync", () => {
  it("every saveRunValues call site stamps (markRunValuesUpdated / saveRunValuesUpdated) or is a pure form flush", () => {
    const violations = [...homeSites, ...formLifecycleSites, ...packagingManagerSites]
      .filter((s) => s.verdict === "VIOLATION");
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
    expect(byName("renameDoughIngredient").length, "master-data rename write").toBeGreaterThan(0);
    expect(
      packagingManagerSites.filter((s) => s.enclosingName === "updateDrainingRun").length,
      "draining-run write",
    ).toBeGreaterThan(0);
    // Rollover pull-up + sync receive adopt REMOTE stamps rather than local ones.
    expect(homeSites.filter((s) => s.verdict === "stamped-remote").length).toBeGreaterThanOrEqual(2);
    // And the file still has a meaningful number of write sites overall.
    expect(homeSites.length).toBeGreaterThanOrEqual(20);
  });

  it("saveRunValues is only exposed through guarded orchestration and its persistence adapter", () => {
    // The guard is scoped to the orchestration call sites. The browser adapter
    // owns the localStorage write itself but must not add orchestration policy.
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
        // Extracted Home managers remain guarded orchestration boundaries:
        // useHomeFormLifecycle owns autosave, while useRunLifecycleManager owns
        // run-switch and transition durability. Their focused tests verify
        // attribution and the required value stamps. LiveRunContext pre-seeds
        // next-run dough counters and stamps immediately afterward.
        if (
          rel === path.join("pages", "home.tsx") ||
          rel === "storage.ts" ||
          rel === path.join("adapters", "browserRunPersistence.ts") ||
          rel === path.join("contexts", "LiveRunContext.tsx") ||
          rel === path.join("hooks", "useHomeFormLifecycle.ts") ||
          rel === path.join("hooks", "useRunLifecycleManager.ts") ||
          rel === "packagingManager.ts"
        ) continue;
        const text = fs.readFileSync(full, "utf8");
        if (/\bsaveRunValues\b/.test(text)) offenders.push(rel);
      }
    };
    walk(srcDir);
    expect(
      offenders,
      "saveRunValues used outside guarded orchestration/persistence boundaries — extend this source guard first",
    ).toEqual([]);
  });
});

describe("source guard: extracted live tabs do not copy raw run-value persistence", () => {
  it("rejects run-value writer imports and unused read-only persistence imports", () => {
    const writerImports = liveTabPersistenceIssues.filter((issue) => issue.kind === "writer-import");
    const unusedReaderImports = liveTabPersistenceIssues.filter((issue) => issue.kind === "unused-reader-import");
    const format = (issue: LiveTabPersistenceIssue) =>
      `  ${issue.file}:${issue.line} — ${issue.name}`;

    expect(
      writerImports,
      `Raw run-value writers must stay in guarded orchestration; extracted tabs must receive callbacks instead:\n` +
        writerImports.map(format).join("\n"),
    ).toEqual([]);
    expect(
      unusedReaderImports,
      `Read-only persistence imports must be used by the extracted module:\n` +
        unusedReaderImports.map(format).join("\n"),
    ).toEqual([]);
  });

  it("keeps the boundary check live against the extracted source set", () => {
    expect(liveTabSourceFiles()).toContain(LIVE_TABS_SUPPORT_FILE);
    expect(liveTabPersistenceIssues).toEqual([]);
  });

  it("self-tests writer and unused-reader detection", () => {
    const issues = inspectLiveTabPersistenceSource(
      `
        import { saveRunValues, loadRunValues, subscribeRunValuesWrites as subscribe } from "../../adapters/browserRunPersistence";
        export function readOnly() {
          return loadRunValues("run-1");
        }
      `,
      path.join(LIVE_STATIONS_DIR, "synthetic.ts"),
    );

    expect(issues.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "writer-import", name: "saveRunValues" },
      { kind: "unused-reader-import", name: "subscribeRunValuesWrites" },
    ]);
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
