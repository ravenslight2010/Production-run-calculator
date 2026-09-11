import assert from "node:assert/strict";
import {
  evaluateReportKeyRotationPreflight,
  parseReportSigningKeyring,
} from "./report-key-rotation-preflight.mts";

const current = "current";
const previous = "previous";
const keyringJson = JSON.stringify({
  activeKeyId: current,
  keys: {
    [current]: "c".repeat(32),
    [previous]: "p".repeat(32),
  },
});

function run(): void {
  const keyring = parseReportSigningKeyring(keyringJson);
  assert.deepEqual(keyring, {
    activeKeyId: current,
    keyIds: [current, previous],
  });
  assert.equal(parseReportSigningKeyring(undefined), null);
  assert.equal(parseReportSigningKeyring(""), null);
  assert.equal(parseReportSigningKeyring("{malformed"), null);
  assert.equal(
    parseReportSigningKeyring(JSON.stringify({
      activeKeyId: "missing",
      keys: { [current]: "c".repeat(32) },
    })),
    null,
  );
  assert.equal(
    parseReportSigningKeyring(JSON.stringify({
      activeKeyId: current,
      keys: { [current]: "too-short" },
    })),
    null,
  );

  const healthy = evaluateReportKeyRotationPreflight({
    keyring,
    storedKeyIds: [current, previous],
    truncated: false,
  });
  assert.equal(healthy.status, "pass");
  assert.equal(healthy.canRotate, true);
  assert.equal(healthy.remediation, null);

  const missing = evaluateReportKeyRotationPreflight({
    keyring,
    storedKeyIds: [current, "removed-historical"],
    truncated: false,
  });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.failure, "missing-retained-keys");
  assert.deepEqual(missing.missingKeyIds, ["removed-historical"]);
  assert.match(missing.remediation ?? "", /removed-historical/);

  const unavailable = evaluateReportKeyRotationPreflight({
    keyring: null,
    storedKeyIds: [current],
    truncated: false,
  });
  assert.equal(unavailable.failure, "keyring-unavailable");
  assert.equal(unavailable.activeKeyId, null);
  assert.match(unavailable.remediation ?? "", /valid OPERATIONAL_REPORT_SIGNING_KEYS/);
  assert.ok(!JSON.stringify(unavailable).includes("c".repeat(32)));

  const truncated = evaluateReportKeyRotationPreflight({
    keyring,
    storedKeyIds: [current],
    truncated: true,
  });
  assert.equal(truncated.failure, "audit-truncated");
  assert.equal(truncated.scan.complete, false);
  assert.equal(truncated.canRotate, false);
  assert.match(truncated.remediation ?? "", /bounded audit/);

  const diagnostics = JSON.stringify(missing);
  assert.ok(!diagnostics.includes("c".repeat(32)));
  assert.ok(!diagnostics.includes("p".repeat(32)));
}

run();