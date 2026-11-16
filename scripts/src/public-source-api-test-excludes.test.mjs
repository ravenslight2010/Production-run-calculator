import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_SOURCE_API_TEST_EXCLUDES,
  publicSourceApiTestExcludes,
  vitestPublicSourceExcludeArgs,
} from "./public-source-api-test-excludes.mjs";

test("public CI without private audit excludes reconciliation API suites", () => {
  const excludes = publicSourceApiTestExcludes({
    env: { CI_PUBLIC_SOURCE: "1" },
    exists: () => false,
  });
  assert.deepEqual(excludes, [...PUBLIC_SOURCE_API_TEST_EXCLUDES]);
  assert.deepEqual(vitestPublicSourceExcludeArgs({
    env: { CI_PUBLIC_SOURCE: "true" },
    exists: () => false,
  }), [
    "--exclude",
    "src/lib/sourceLibraryReconciliationCapture.test.ts",
    "--exclude",
    "src/lib/sourceLibraryReconciliationHeal.integration.test.ts",
  ]);
});

test("private-source or present audit keeps reconciliation API suites", () => {
  assert.deepEqual(
    publicSourceApiTestExcludes({
      env: { CI_PUBLIC_SOURCE: "1" },
      exists: () => true,
    }),
    [],
  );
  assert.deepEqual(
    publicSourceApiTestExcludes({
      env: {},
      exists: () => false,
    }),
    [],
  );
});
