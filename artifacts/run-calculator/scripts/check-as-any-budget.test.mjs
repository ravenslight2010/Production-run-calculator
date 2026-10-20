import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkAsAnyBudget,
  collectMaintainedSourceFiles,
  createAsAnyBaseline,
  scanAsAnyCasts,
} from "./check-as-any-budget.mjs";

function withSourceTree(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "calculator-any-budget-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, source);
    }
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("AST scan counts as-any assertions but ignores comments and string contents", () => {
  const locations = scanAsAnyCasts(
    [
      "const first = value as any;",
      "// ignored = value as any",
      "/* ignored = value as any */",
      'const text = "value as any";',
      "const template = `value as any`;",
      "const angleAssertion = <any>value;",
    ].join("\n"),
  );

  assert.deepEqual(locations, [{ line: 1, column: 24 }]);
});

test("source collection excludes tests, generated output, and non-source files", () => {
  withSourceTree(
    {
      "main.ts": "const value = input as any;",
      "feature.test.ts": "const value = input as any;",
      "feature.spec.tsx": "const value = input as any;",
      "__tests__/nested.ts": "const value = input as any;",
      "generated/feature.ts": "const value = input as any;",
      "feature.generated.ts": "const value = input as any;",
      "feature.gen.tsx": "const value = input as any;",
      "dist/feature.ts": "const value = input as any;",
      "notes.txt": "const value = input as any;",
    },
    (root) => {
      assert.deepEqual(
        collectMaintainedSourceFiles(root).map((file) => file.relativePath),
        ["main.ts"],
      );
    },
  );
});

test("a new cast fails with the exact source file and line", () => {
  withSourceTree(
    {
      "components/Widget.tsx": [
        "const safe = value as string;",
        "const unsafe = other as any;",
      ].join("\n"),
    },
    (root) => {
      const files = collectMaintainedSourceFiles(root);
      assert.throws(
        () =>
          checkAsAnyBudget({
            files,
            baseline: { version: 1, total: 0, files: {} },
          }),
        /components\/Widget\.tsx:2:25: `as any` found; file has 1, reviewed baseline is 0/,
      );
    },
  );
});

test("the generated baseline records current per-file counts and total", () => {
  withSourceTree(
    {
      "first.ts": "const one = value as any;",
      "second.tsx": "const two = value as any;\nconst three = value as any;",
    },
    (root) => {
      const baseline = createAsAnyBaseline(collectMaintainedSourceFiles(root));
      assert.deepEqual(baseline, {
        version: 1,
        total: 3,
        files: { "first.ts": 1, "second.tsx": 2 },
      });
    },
  );
});

test("an unparsable maintained source fails closed", () => {
  assert.throws(
    () => scanAsAnyCasts("const value = ( as any;", "broken.ts"),
    /Unable to parse maintained source "broken\.ts"/,
  );
});
