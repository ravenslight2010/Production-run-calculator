import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import test from "node:test";
import type {
  FullConfig,
  FullResult,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import CompatibilityDebugReporter, {
  sanitizePngScreenshot,
} from "./compatibility-debug-reporter.ts";

const specPath = fileURLToPath(new URL("./release-webkit-smoke.spec.ts", import.meta.url));
const PNG_TEXT_CANARY = "VISIBLE_TEXT_CANARY";
const SECRET_CANARIES = [
  "TOKEN_CANARY",
  "QUERY_CANARY",
  "BODY_CANARY",
  "COOKIE_CANARY",
  "STORAGE_CANARY",
  PNG_TEXT_CANARY,
];

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngWithTextMetadata(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, "ascii");
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
    return Buffer.concat([header, data, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk("tEXt", Buffer.from(`debug-note\0${PNG_TEXT_CANARY}`)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fakeTestCase(projectName: string, title: string): TestCase {
  return {
    id: `${projectName}:${title}`,
    title,
    expectedStatus: "passed",
    location: { file: specPath, line: 180, column: 4 },
    parent: { project: () => ({ name: projectName }) },
  } as unknown as TestCase;
}

function fakeFailureResult(screenshot: Buffer): TestResult {
  return {
    status: "failed",
    duration: 640,
    errors: [
      {
        name: "CredentialError",
        message: `token=${SECRET_CANARIES[0]} request=${SECRET_CANARIES[2]}`,
        stack: `cookie=${SECRET_CANARIES[3]}`,
      },
    ],
    attachments: [
      {
        name: "masked-failure-screenshot",
        contentType: "image/png",
        body: screenshot,
      },
      {
        name: "trace",
        contentType: "application/zip",
        path: "/tmp/untrusted-raw-trace.zip",
      },
    ],
    stdout: [`storage=${SECRET_CANARIES[4]}`],
    stderr: [`query=${SECRET_CANARIES[1]}`],
    steps: [
      {
        category: "pw:api",
        title: `fill(${SECRET_CANARIES[2]})`,
        duration: 41,
        location: { file: specPath, line: 192, column: 6 },
        params: { requestBody: SECRET_CANARIES[2] },
        steps: [
          {
            category: "expect",
            title: `expect(${SECRET_CANARIES[4]})`,
            duration: 88,
            location: { file: specPath, line: 193, column: 6 },
          },
        ],
      },
    ],
  } as unknown as TestResult;
}

function setTestEnvironment(runnerTemp: string): () => void {
  const keys = [
    "CI",
    "RUNNER_TEMP",
    "PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_SHA",
  ];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CI = "true";
  process.env.RUNNER_TEMP = runnerTemp;
  process.env.PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR = join(
    runnerTemp,
    "responsive-webkit-debug-456-2",
  );
  process.env.GITHUB_RUN_ID = "456";
  process.env.GITHUB_RUN_ATTEMPT = "2";
  process.env.GITHUB_SHA = "a".repeat(40);
  return () => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("failed responsive WebKit fixture retains only useful sanitized diagnostics", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "webkit-debug-reporter-"));
  const runnerTemp = join(temporaryRoot, "runner-temp");
  const browserOutput = join(temporaryRoot, "browser-output");
  await Promise.all([mkdir(runnerTemp), mkdir(browserOutput)]);
  const restoreEnvironment = setTestEnvironment(runnerTemp);

  try {
    const rawScreenshot = pngWithTextMetadata();
    const sanitizedScreenshot = sanitizePngScreenshot(rawScreenshot);
    assert.ok(rawScreenshot.includes(PNG_TEXT_CANARY));
    assert.ok(!sanitizedScreenshot.includes(PNG_TEXT_CANARY));

    const reporter = new CompatibilityDebugReporter();
    reporter.onBegin({ outputDir: browserOutput } as FullConfig);
    reporter.onTestEnd(
      fakeTestCase(
        "phone-webkit",
        "manager can preview an authoritative operational report",
      ),
      fakeFailureResult(rawScreenshot),
    );
    await reporter.onEnd({ status: "failed" } as FullResult);

    const outputDirectory = process.env.PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR!;
    const outputFiles = (await readdir(outputDirectory)).sort();
    assert.deepEqual(outputFiles, [
      "manifest.json",
      "phone-webkit-failure-01.png",
      "trace-summary.json",
    ]);

    const manifest = await readFile(join(outputDirectory, "manifest.json"), "utf8");
    const summary = await readFile(
      join(outputDirectory, "trace-summary.json"),
      "utf8",
    );
    const screenshot = await readFile(
      join(outputDirectory, "phone-webkit-failure-01.png"),
    );
    const serialized = `${manifest}\n${summary}\n${screenshot.toString("latin1")}`;
    for (const canary of SECRET_CANARIES) {
      assert.ok(!serialized.includes(canary), `must omit ${canary}`);
    }
    assert.match(manifest, /isolated-disposable-ci-fixture/u);
    assert.match(manifest, /"revision": "test-sha256:[a-f0-9]{64}"/u);
    assert.match(manifest, /"retentionDays": 3/u);

    const trace = JSON.parse(summary) as {
      failureCount: number;
      failures: Array<{
        project: string;
        testId: string;
        failureType: string;
        durationMs: number;
        location?: { file: string; line: number };
        steps: Array<{ category: string; durationMs: number }>;
        screenshot?: string;
      }>;
    };
    assert.equal(trace.failureCount, 1);
    assert.equal(trace.failures[0]?.project, "phone-webkit");
    assert.equal(trace.failures[0]?.testId, "report-preview");
    assert.equal(trace.failures[0]?.failureType, "runtime");
    assert.equal(trace.failures[0]?.durationMs, 640);
    assert.equal(trace.failures[0]?.location?.file, "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts");
    assert.equal(trace.failures[0]?.screenshot, "phone-webkit-failure-01.png");
    assert.deepEqual(
      trace.failures[0]?.steps.map((step) => step.category),
      ["pw:api", "expect"],
    );
    assert.deepEqual(
      trace.failures[0]?.steps.map((step) => step.durationMs),
      [41, 88],
    );
  } finally {
    restoreEnvironment();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("passing responsive WebKit fixtures do not create debug artifacts", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "webkit-debug-pass-"));
  const runnerTemp = join(temporaryRoot, "runner-temp");
  const browserOutput = join(temporaryRoot, "browser-output");
  await Promise.all([mkdir(runnerTemp), mkdir(browserOutput)]);
  const restoreEnvironment = setTestEnvironment(runnerTemp);

  try {
    const reporter = new CompatibilityDebugReporter();
    reporter.onBegin({ outputDir: browserOutput } as FullConfig);
    const testCase = fakeTestCase(
      "tablet-webkit",
      "manager can preview an authoritative operational report",
    );
    reporter.onTestEnd(
      testCase,
      fakeFailureResult(pngWithTextMetadata()),
    );
    reporter.onTestEnd(
      testCase,
      {
        status: "passed",
        duration: 200,
        errors: [],
        attachments: [],
        steps: [],
      } as unknown as TestResult,
    );
    await reporter.onEnd({ status: "passed" } as FullResult);

    await assert.rejects(
      readdir(process.env.PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR!),
      { code: "ENOENT" },
    );
  } finally {
    restoreEnvironment();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("refuses PNG metadata canaries in retained screenshot bytes", () => {
  const cleanPng = sanitizePngScreenshot(pngWithTextMetadata());
  assert.ok(cleanPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.ok(!cleanPng.includes(PNG_TEXT_CANARY));
  assert.throws(
    () => sanitizePngScreenshot(Buffer.from("not a png")),
    /Invalid or oversized PNG screenshot/u,
  );
});