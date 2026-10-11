import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { sourceFixture, put } from "./fixtures/build-identity-fixture.mjs";
import { captureReleaseIdentity, isDeploymentRevision, isEvidenceRevision } from "./release-source-identity.mjs";

function fixture(t) {
  const root = sourceFixture(t);
  put(root, "scripts/package.json", "{}");
  return root;
}

test("assessment identity works without Git or GitHub and is deterministic", (t) => {
  const root = fixture(t);
  assert.equal(existsSync(`${root}/.git`), false);
  const previousPath = process.env.PATH;
  process.env.PATH = "";
  let first;
  try {
    first = captureReleaseIdentity(root);
    assert.deepEqual(captureReleaseIdentity(root), first);
  } finally { process.env.PATH = previousPath; }
  assert.match(first.revision, /^test-sha256:[a-f0-9]{64}$/);
  assert.match(first.sourceRevision, /^source-sha256:[a-f0-9]{64}$/);
});

test("changing tests invalidates assessment evidence, not the production source identity", (t) => {
  const root = fixture(t);
  const before = captureReleaseIdentity(root);
  put(root, "scripts/src/example.test.mjs", "test('a new required check', () => {});");
  const after = captureReleaseIdentity(root);
  assert.equal(after.sourceRevision, before.sourceRevision);
  assert.notEqual(after.verificationFingerprintSha256, before.verificationFingerprintSha256);
  assert.notEqual(after.revision, before.revision);
});

test("changing production source invalidates both source and assessment evidence", (t) => {
  const root = fixture(t);
  const before = captureReleaseIdentity(root);
  put(root, "artifacts/api-server/src/index.ts", "export const changed = true;");
  const after = captureReleaseIdentity(root);
  assert.notEqual(after.sourceRevision, before.sourceRevision);
  assert.notEqual(after.revision, before.revision);
});

test("changing a test command invalidates assessment evidence", (t) => {
  const root = fixture(t);
  const before = captureReleaseIdentity(root);
  put(root, "scripts/package.json", '{"scripts":{"test":"a different required command"}}');
  assert.notEqual(captureReleaseIdentity(root).revision, before.revision);
});

test("legacy identities remain readable but assessment IDs are not deployment IDs", () => {
  assert(isDeploymentRevision(`source-sha256:${"a".repeat(64)}`));
  assert(isEvidenceRevision(`test-sha256:${"b".repeat(64)}`));
  assert(isDeploymentRevision("c".repeat(40)));
  assert(!isDeploymentRevision(`test-sha256:${"b".repeat(64)}`));
  for (const invalid of ["", "unknown", "a".repeat(64), "source-sha256:fake"])
    assert(!isEvidenceRevision(invalid));
});