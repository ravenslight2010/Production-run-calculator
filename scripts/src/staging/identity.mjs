import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// This is deliberately not a general-purpose "approve a DATABASE_URL" helper.
// The runner mints this descriptor only after creating its own private cluster.
export function assertStageIdentity(expected, observed) {
  assert.equal(expected.kind, "isolated-local-staging");
  assert.match(expected.runId, /^[a-f0-9]{32}$/);
  assert.equal(expected.database, `stage_${expected.runId}`);
  assert.equal(expected.host, "127.0.0.1");
  assert.equal(observed.host, expected.host);
  assert.equal(observed.database, expected.database);
  assert.equal(observed.port, expected.port);
  assert.equal(observed.dataDirectory, expected.dataDirectory);
  assert.equal(observed.systemIdentifier, expected.systemIdentifier);
  assert.match(expected.systemIdentifier, /^\d{15,25}$/);
  assert.equal(observed.owner, "postgres");
  assert.equal(observed.runId, expected.runId);
}

export function assertStageApp(expected, served) {
  assert.equal(expected.kind, "isolated-local-staging");
  assert.equal(served.runId, expected.runId);
  assert.equal(served.appBuildId, expected.build.appBuildId);
  assert.equal(served.sourceFingerprintSha256, expected.build.sourceFingerprintSha256);
  assert.equal(served.buildMode, "development");
  assert.equal(served.platformDeploymentId, null);
  assert.equal(served.platformBuildId, null);
}

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stageEnvironment(parent) {
  // Never spread process.env here: in a task workspace it contains shared DB
  // credentials, production-manager credentials, session keys and AI keys.
  const result = {};
  for (const key of ["PATH", "HOME", "LANG", "TMPDIR", "NIX_SSL_CERT_FILE",
    "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]) {
    if (parent[key]) result[key] = parent[key];
  }
  return { ...result, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
    BUILD_IDENTITY_MODE: "development", CI: "1" };
}
