import assert from "node:assert/strict";
import test from "node:test";
import {
  auditOverrideCompatibility,
  parseYamlMappings,
  versionSatisfies,
} from "./check-override-compatibility.mjs";

function audit({ overrides, packages = {}, snapshots, manifests = {} }) {
  return auditOverrideCompatibility({
    overrides,
    lockfile: { packages, snapshots },
    manifests,
  });
}

test("parses the workspace overrides and lockfile mapping shapes", () => {
  const parsed = parseYamlMappings(`
overrides:
  "parent>child": "3.2.0"
  child@2: ^2.4.0
  optional-child: "-"
packages:
  child@2.4.1:
    peerDependencies:
      peer-lib: ^1.0.0
`);

  assert.deepEqual(parsed.overrides, {
    "parent>child": "3.2.0",
    "child@2": "^2.4.0",
    "optional-child": "-",
  });
  assert.equal(parsed.packages["child@2.4.1"].peerDependencies["peer-lib"], "^1.0.0");
});

test("supports exact, caret, tilde, and combined compatible ranges", () => {
  assert.equal(versionSatisfies("3.2.4", "3.2.4"), true);
  assert.equal(versionSatisfies("3.9.0", "^3.2.0"), true);
  assert.equal(versionSatisfies("7.29.7", "^7.0.0-0"), true);
  assert.equal(versionSatisfies("3.2.9", "~3.2.0"), true);
  assert.equal(versionSatisfies("4.0.0", ">=3.2.0 <4"), false);
  assert.equal(versionSatisfies("3.2.5", "3.2.4"), false);
});

test("catches a global override that forces an incompatible major", () => {
  const result = audit({
    overrides: { library: "3.1.0" },
    snapshots: {
      "consumer@1.0.0": { dependencies: { library: "3.1.0" } },
      "library@3.1.0": {},
    },
    manifests: {
      "consumer@1.0.0": { dependencies: { library: "^2.4.0" } },
    },
  });

  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], {
    override: "library",
    parent: "consumer@1.0.0",
    dependency: "library",
    resolved: "3.1.0",
    declaredRange: "^2.4.0",
    kind: "dependency",
  });
});

test("limits parent-scoped overrides to matching parent versions", () => {
  const result = audit({
    overrides: { "legacy-parent@1>library": "3.1.0" },
    snapshots: {
      "legacy-parent@1.2.0": { dependencies: { library: "3.1.0" } },
      "legacy-parent@2.1.0": { dependencies: { library: "2.8.0" } },
      "library@2.8.0": {},
      "library@3.1.0": {},
    },
    manifests: {
      "legacy-parent@1.2.0": { dependencies: { library: "^3.0.0" } },
      "legacy-parent@2.1.0": { dependencies: { library: "^2.0.0" } },
    },
  });

  assert.deepEqual(result.findings, []);
  assert.equal(result.checked, 1);
});

test("treats an exact consumer pin as incompatible with a different patch", () => {
  const result = audit({
    overrides: { library: "2.4.2" },
    snapshots: {
      "pinned-consumer@1.0.0": { dependencies: { library: "2.4.2" } },
      "library@2.4.2": {},
    },
    manifests: {
      "pinned-consumer@1.0.0": { dependencies: { library: "2.4.1" } },
    },
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].declaredRange, "2.4.1");
});

test("keeps approved exceptions exact and reports changed consumer contracts", () => {
  const checkTypographyRange = (range) => audit({
    overrides: {
      "@tailwindcss/typography>postcss-selector-parser": "7.1.6",
    },
    snapshots: {
      "@tailwindcss/typography@0.5.20": {
        dependencies: { "postcss-selector-parser": "7.1.6" },
      },
      "postcss-selector-parser@7.1.6": {},
    },
    manifests: {
      "@tailwindcss/typography@0.5.20": {
        dependencies: { "postcss-selector-parser": range },
      },
    },
  });

  const approved = checkTypographyRange("6.0.10");
  assert.deepEqual(approved.findings, []);
  assert.equal(approved.approvedExceptions.length, 1);

  const changed = checkTypographyRange("6.0.11");
  assert.equal(changed.approvedExceptions.length, 0);
  assert.equal(changed.findings.length, 1);
  assert.equal(changed.findings[0].declaredRange, "6.0.11");
});

test("limits an approved esbuild exception to its exact parent version", () => {
  const approved = audit({
    overrides: { esbuild: "^0.28.1" },
    snapshots: {
      "drizzle-kit@0.31.11": { dependencies: { esbuild: "0.28.2" } },
      "esbuild@0.28.2": {},
    },
    manifests: {
      "drizzle-kit@0.31.11": { dependencies: { esbuild: "^0.25.4" } },
    },
  });

  assert.deepEqual(approved.findings, []);
  assert.equal(approved.approvedExceptions.length, 1);
  assert.equal(approved.approvedExceptions[0].parent, "drizzle-kit@0.31.11");

  const changedParent = audit({
    overrides: { esbuild: "^0.28.1" },
    snapshots: {
      "drizzle-kit@0.31.12": { dependencies: { esbuild: "0.28.2" } },
      "esbuild@0.28.2": {},
    },
    manifests: {
      "drizzle-kit@0.31.12": { dependencies: { esbuild: "^0.25.4" } },
    },
  });

  assert.equal(changedParent.approvedExceptions.length, 0);
  assert.equal(changedParent.findings.length, 1);
});

test("checks peer dependency ranges recorded in lockfile metadata", () => {
  const result = audit({
    overrides: { "peer-library": "4.0.0" },
    packages: {
      "peer-consumer@1.0.0": {
        peerDependencies: { "peer-library": "^3.0.0" },
      },
    },
    snapshots: {
      "peer-consumer@1.0.0(peer-library@4.0.0)": {},
      "peer-library@4.0.0": {},
    },
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, "peer dependency");
});

test("does not fail intentional optional-package exclusions or absent optional peers", () => {
  const result = audit({
    overrides: {
      "optional-library": "-",
      "peer-consumer>optional-peer": "-",
    },
    packages: {
      "peer-consumer@1.0.0": {
        peerDependencies: { "optional-peer": "^2.0.0" },
        peerDependenciesMeta: { "optional-peer": { optional: true } },
      },
    },
    snapshots: {
      "consumer@1.0.0": {
        optionalDependencies: { "optional-library": "1.0.0" },
      },
      "optional-library@1.0.0": {},
      "peer-consumer@1.0.0": {},
    },
    manifests: {
      "consumer@1.0.0": {
        optionalDependencies: { "optional-library": "^2.0.0" },
      },
    },
  });

  assert.deepEqual(result.findings, []);
  assert.ok(result.excluded > 0);
});
