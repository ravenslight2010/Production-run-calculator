import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findAgentMemoryInfrastructure,
  formatAgentMemoryFinding,
  isScannedAgentMemoryPath,
} from "./check-agent-memory-infrastructure.mts";

test("flags private hosts and deployment image references without printing matched values", () => {
  const host = "service.internal";
  const address = "192.168.42.18";
  const image = "FROM registry.example.invalid/api/worker:6.2.1-build.4";
  const digest = "a".repeat(64);
  const content = [
    `A service is reachable at ${host}.`,
    `A private address is ${address}.`,
    image,
    `image: registry.example.invalid/api/worker@sha256:${digest}`,
  ].join("\n");

  const findings = findAgentMemoryInfrastructure(
    ".agents/memory/example.md",
    content,
  );
  assert.deepEqual(
    findings.map(({ file, line, category }) => ({ file, line, category })),
    [
      {
        file: ".agents/memory/example.md",
        line: 1,
        category: "infrastructure host",
      },
      {
        file: ".agents/memory/example.md",
        line: 2,
        category: "infrastructure host",
      },
      {
        file: ".agents/memory/example.md",
        line: 3,
        category: "deployment image reference",
      },
      {
        file: ".agents/memory/example.md",
        line: 4,
        category: "deployment image reference",
      },
    ],
  );

  const diagnostic = findings
    .map((finding) =>
      formatAgentMemoryFinding(finding, "/repo"),
    )
    .join("\n");
  for (const matchedValue of [
    host,
    address,
    image,
    "worker:6.2.1-build.4",
    digest,
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("allows loopback examples and templated development URLs", () => {
  const content = [
    "Use http://localhost:5000 for a local preview.",
    "Use http://127.0.0.1:8080 for the loopback API.",
    "The IPv6 loopback address is ::1.",
    "Development preview: https://${REPLIT_DEV_DOMAIN}.",
    "Development preview: https://<dev-domain>.replit.dev.",
    "Development preview: https://{{dev_domain}}.",
    "The public API is https://generativelanguage.googleapis.com.",
    "FROM a-supported-runtime-image",
  ].join("\n");

  assert.deepEqual(
    findAgentMemoryInfrastructure(".agents/memory/example.md", content),
    [],
  );
});

test("flags synthetic mailing addresses without echoing them and allows technical text", () => {
  const streetAddress = "4827 W. Cedarbrook Avenue";
  const mailingAddress = "91 Maple Street, Sampletown, IL 60614";
  const postOfficeBox = "P.O. Box 4821";
  const content = [
    `Synthetic street: ${streetAddress}.`,
    `Synthetic full mailing address: ${mailingAddress}.`,
    `Synthetic PO Box: ${postOfficeBox}.`,
    "Technical path: scripts/src/check-agent-memory-infrastructure.mts.",
    "Runtime Node 22.4.1, API v2, reviewed 2026-10-21.",
  ].join("\n");
  const findings = findAgentMemoryInfrastructure(
    ".agents/memory/example.md",
    content,
  );

  assert.deepEqual(
    findings.map(({ line, category }) => ({ line, category })),
    [
      { line: 1, category: "mailing address" },
      { line: 2, category: "mailing address" },
      { line: 3, category: "mailing address" },
    ],
  );

  const diagnostic = findings
    .map((finding) => formatAgentMemoryFinding(finding, "/repo"))
    .join("\n");
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

test("scans only Markdown memory notes and excludes fix history", () => {
  assert.equal(isScannedAgentMemoryPath(".agents/memory/lesson.md"), true);
  assert.equal(
    isScannedAgentMemoryPath(".agents/memory/codex-fixes.md"),
    false,
  );
  assert.equal(
    isScannedAgentMemoryPath(".agents/memory/nested/lesson.md"),
    true,
  );
  assert.equal(isScannedAgentMemoryPath(".agents/memory/lesson.txt"), false);
  assert.equal(isScannedAgentMemoryPath("docs/lesson.md"), false);

  assert.deepEqual(
    findAgentMemoryInfrastructure(
      ".agents/memory/codex-fixes.md",
      "service.internal\nFROM registry.example.invalid/service:4.2",
    ),
    [],
  );
});

test("matches only private address ranges and does not classify public hosts", () => {
  const content = [
    "Public resolver: 8.8.8.8.",
    "Loopback resolver: 127.0.0.1.",
    "Private network peer: 10.2.3.4.",
    "Private network peer: 172.31.255.1.",
    "Private network peer: 192.168.0.9.",
    "Link-local peer: 169.254.1.2.",
    "Public IPv6 resolver: 2001:4860:4860::8888.",
    "IPv6 loopback: ::1.",
    "ULA peer: fd12:3456:789a::8.",
    "IPv6 link-local peer: fe80::ab.",
  ].join("\n");

  assert.deepEqual(
    findAgentMemoryInfrastructure(".agents/memory/example.md", content).map(
      ({ line, category }) => ({ line, category }),
    ),
    [
      { line: 3, category: "infrastructure host" },
      { line: 4, category: "infrastructure host" },
      { line: 5, category: "infrastructure host" },
      { line: 6, category: "infrastructure host" },
      { line: 9, category: "infrastructure host" },
      { line: 10, category: "infrastructure host" },
    ],
  );
});
