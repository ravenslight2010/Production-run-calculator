import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  findFixHistoryDetails,
  formatFixHistoryFinding,
} from "./check-codex-fixes.mts";

const notePath = resolve(
  import.meta.dirname,
  "../../.agents/memory/codex-fixes.md",
);

test("the current fix-history note contains no flagged operational details", async () => {
  const content = await readFile(notePath, "utf8");
  assert.deepEqual(findFixHistoryDetails(content), []);
});

test("flags private infrastructure, deployment image tags, and actionable watch details without echoing values", () => {
  const privateHost = "ops-cache.internal";
  const privateAddress = "10.44.8.21";
  const imageTag = "registry.example.invalid/service:8.4.2-build.7";
  const watchDetail = "Monitor queue_lag every 4 seconds and alert at threshold";
  const content = [
    `Service was reached at ${privateHost}.`,
    `The diagnostic peer was ${privateAddress}.`,
    `FROM ${imageTag}`,
    watchDetail,
  ].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "infrastructure identifier" },
    { line: 2, category: "infrastructure identifier" },
    { line: 3, category: "deployment image tag" },
    { line: 4, category: "actionable operational watch detail" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [
    privateHost,
    privateAddress,
    imageTag,
    "queue_lag",
    "4 seconds",
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("flags email addresses and phone numbers by category and line without echoing values", () => {
  const email = "staff.member@example.invalid";
  const secondEmail = "ops@example.test";
  const phone = "+1 (202) 555-0147";
  const localPhone = "555-0147";
  const content = [
    `Contact the team at ${email}.`,
    `Send an update to ${secondEmail}.`,
    `Call ${phone} if the station is unavailable.`,
    `The local contact number is ${localPhone}.`,
  ].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "contact detail" },
    { line: 2, category: "contact detail" },
    { line: 3, category: "contact detail" },
    { line: 4, category: "contact detail" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [email, secondEmail, phone, localPhone]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("flags synthetic street and mailing addresses without echoing their contents", () => {
  const streetAddress = "4827 W. Cedarbrook Avenue";
  const mailingAddress = "91 Maple Street, Sampletown, IL 60614";
  const postOfficeBox = "P.O. Box 4821";
  const content = [
    `The sample delivery location is ${streetAddress}.`,
    `Mail the synthetic package to ${mailingAddress}.`,
    `The alternate synthetic destination is ${postOfficeBox}.`,
  ].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "mailing address" },
    { line: 2, category: "mailing address" },
    { line: 3, category: "mailing address" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [
    streetAddress,
    mailingAddress,
    postOfficeBox,
    "Sampletown",
    "60614",
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("flags mailing addresses split across adjacent lines without echoing their contents", () => {
  const street = "91 Maple Street";
  const cityPostal = "Sampletown, IL 60614";
  const content = `${street}\n${cityPostal}`;

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "mailing address" },
    { line: 2, category: "mailing address" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [street, "Sampletown", "60614"]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("flags synthetic street, suite or unit, and city lines without echoing their contents", () => {
  const suiteAddress = [
    "91 Maple Street",
    "Suite 210",
    "Sampletown, IL 60614",
  ];
  const unitAddress = [
    "4827 W. Cedarbrook Avenue",
    "Apt. 4B",
    "Northfield, CA 90210-1234",
  ];
  const content = [...suiteAddress, ...unitAddress].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(
    findings,
    [1, 2, 3, 4, 5, 6].map((line) => ({
      line,
      category: "mailing address" as const,
    })),
  );

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [
    ...suiteAddress,
    ...unitAddress,
    "Sampletown",
    "60614",
    "Northfield",
    "90210-1234",
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("allows benign adjacent technical lines, paths, release numbers, and dates", () => {
  const content = [
    "The helper uses",
    "scripts/src/check-codex-fixes.test.mts",
    "Release 3.12.0 shipped after",
    "the review date 2026-10-21.",
    "Node 22.4.1 supports API v2;",
    "the local development server uses port 8080.",
    "A street matcher checks",
    "its input one line at a time.",
    "The parser splits suite",
    "and unit tests into separate groups.",
    "A build unit",
    "is deployed to Sampletown, IL 60614.",
    "91 Maple Street",
    "Unit tests",
    "Sampletown, IL 60614",
  ].join("\n");

  assert.deepEqual(findFixHistoryDetails(content), [
    { line: 13, category: "mailing address" },
  ]);
});

test("flags synthetic credential values, private-key markers, and URL user-info without echoing values", () => {
  const password = "synthetic-password-73";
  const bearer = "synthetic-bearer-credential-482";
  const privateKeyMarker = "-----BEGIN PRIVATE KEY-----";
  const urlUserInfo = "synthetic-user:synthetic-password";
  const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.synthetic-signature-value";
  const knownToken = "ghp_syntheticCredentialValue123456";
  const content = [
    `password = ${password}`,
    `Authorization: Bearer ${bearer}`,
    privateKeyMarker,
    `https://${urlUserInfo}@service.example.invalid/path`,
    jwt,
    knownToken,
  ].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "credential value" },
    { line: 2, category: "credential value" },
    { line: 3, category: "private-key material" },
    { line: 4, category: "credential value" },
    { line: 5, category: "credential value" },
    { line: 6, category: "credential value" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [
    password,
    bearer,
    privateKeyMarker,
    urlUserInfo,
    jwt,
    knownToken,
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("allows safe variable names and explicit credential placeholders", () => {
  const content = [
    "API_TOKEN",
    "TOKEN=$SESSION_TOKEN",
    "SECRET=process.env.SESSION_SECRET",
    "PASSWORD=<redacted>",
    "api_key: your_api_key",
    "Bearer <token>",
    "https://user:password@example.invalid/path",
  ].join("\n");

  assert.deepEqual(findFixHistoryDetails(content), []);
});

test("allows generic lessons and the known harmless public API endpoint", () => {
  const content = [
    "A bounded retry preserves the original error for diagnosis.",
    "The public endpoint is https://generativelanguage.googleapis.com.",
    "A container build uses a supported runtime image.",
    "Operational checks should report a category and line, not matched text.",
    "scripts/src/check-codex-fixes.test.mts and .agents/memory/codex-fixes.md are technical paths.",
    "Node 22.4.1 supports API v2; the local development server uses port 8080.",
    "Release 3.12.0 shipped after the review date 2026-10-21.",
    "The date October 21, 2026 is written in long form.",
  ].join("\n");

  assert.deepEqual(findFixHistoryDetails(content), []);
});
