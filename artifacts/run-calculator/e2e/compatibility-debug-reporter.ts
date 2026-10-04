import { captureReleaseIdentity } from "../../../scripts/src/release-source-identity.mjs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const SAFE_SCREENSHOT_ATTACHMENT = "masked-failure-screenshot";
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_STEPS_PER_FAILURE = 120;
const MAX_FAILURES = 30;
const OUTPUT_PREFIX = "responsive-webkit-debug-";
const ALLOWED_PROJECTS = new Set(["phone-webkit", "tablet-webkit"]);
const ALLOWED_STEP_CATEGORIES = new Set([
  "expect",
  "fixture",
  "hook",
  "pw:api",
  "test.step",
  "test.attach",
]);
const SAFE_TEST_IDS = new Map([
  [
    "authenticates and preserves current-run start, pause, resume, and reload",
    "run-lifecycle",
  ],
  [
    "recovers a failed sync pull after the browser reconnects",
    "sync-reconnect",
  ],
  [
    "manager can preview an authoritative operational report",
    "report-preview",
  ],
]);

type SafeLocation = {
  file: string;
  line: number;
  column: number;
};

type SafeStep = {
  category: string;
  durationMs: number;
  location?: SafeLocation;
};

type FailureRecord = {
  project: "phone-webkit" | "tablet-webkit";
  testId: string;
  status: "failed" | "timedOut";
  failureType: "assertion" | "timeout" | "runtime" | "unknown";
  durationMs: number;
  location?: SafeLocation;
  steps: SafeStep[];
  screenshotPath?: string;
  screenshotBody?: Buffer;
};

type SerializedFailure = Omit<FailureRecord, "screenshotPath" | "screenshotBody"> & {
  id: string;
  screenshot?: string;
};

type DebugOutput = {
  directory: string;
  revision: string;
  runId: string;
  attempt: number;
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SAFE_PNG_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Keep only PNG chunks required to render the screenshot. Text and other
 * ancillary metadata chunks are discarded; malformed or unknown critical
 * chunks make the image ineligible for retention.
 */
export function sanitizePngScreenshot(input: Buffer): Buffer {
  if (
    input.length < PNG_SIGNATURE.length + 25 ||
    input.length > MAX_SCREENSHOT_BYTES ||
    !input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Invalid or oversized PNG screenshot");
  }

  const retainedChunks: Buffer[] = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawHeader = false;
  let sawPalette = false;
  let sawTransparency = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;

  while (offset < input.length) {
    if (offset + 12 > input.length) throw new Error("Truncated PNG chunk");
    const dataLength = input.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > input.length) throw new Error("Truncated PNG data");

    const type = input.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("Invalid PNG chunk type");
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    const expectedCrc = input.readUInt32BE(dataEnd);
    const actualCrc = crc32(input.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) throw new Error("Invalid PNG chunk checksum");

    if (!sawHeader) {
      if (type !== "IHDR" || chunkIndex !== 0 || dataLength !== 13) {
        throw new Error("PNG header is missing or malformed");
      }
      sawHeader = true;
    } else if (type === "IHDR") {
      throw new Error("PNG contains duplicate headers");
    }

    if (type === "PLTE") {
      if (sawPalette || sawImageData) throw new Error("Invalid PNG palette order");
      sawPalette = true;
    }
    if (type === "tRNS") {
      if (sawTransparency || sawImageData) {
        throw new Error("Invalid PNG transparency order");
      }
      sawTransparency = true;
    }
    if (type === "IDAT") {
      if (imageDataEnded) throw new Error("PNG image data is not contiguous");
      sawImageData = true;
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }

    if (type === "IEND") {
      if (dataLength !== 0 || chunkEnd !== input.length || !sawImageData) {
        throw new Error("PNG end marker is invalid");
      }
      sawEnd = true;
    }

    if (!SAFE_PNG_CHUNKS.has(type) && (type.charCodeAt(0) & 0x20) === 0) {
      throw new Error("PNG contains an unsupported critical chunk");
    }
    if (SAFE_PNG_CHUNKS.has(type)) {
      retainedChunks.push(input.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    chunkIndex += 1;
    if (sawEnd) break;
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new Error("PNG is incomplete");
  }
  return Buffer.concat(retainedChunks);
}

function safeLocation(location?: {
  file: string;
  line: number;
  column: number;
}): SafeLocation | undefined {
  if (!location || !Number.isInteger(location.line) || location.line < 1) {
    return undefined;
  }

  const absolutePath = resolve(location.file);
  const relativePath = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath) ||
    !/^[A-Za-z0-9_./-]+$/.test(relativePath)
  ) {
    return undefined;
  }

  return {
    file: relativePath,
    line: location.line,
    column:
      Number.isInteger(location.column) && location.column >= 0
        ? location.column
        : 0,
  };
}

function boundedDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return Math.min(Math.round(duration), 15 * 60 * 1000);
}

function collectSafeSteps(steps: TestStep[]): SafeStep[] {
  const safeSteps: SafeStep[] = [];
  const visit = (current: TestStep[], depth: number): void => {
    if (depth > 8 || safeSteps.length >= MAX_STEPS_PER_FAILURE) return;
    for (const step of current) {
      if (safeSteps.length >= MAX_STEPS_PER_FAILURE) break;
      safeSteps.push({
        category: ALLOWED_STEP_CATEGORIES.has(step.category)
          ? step.category
          : "other",
        durationMs: boundedDuration(step.duration),
        ...(safeLocation(step.location) ? { location: safeLocation(step.location) } : {}),
      });
      if (step.steps?.length) visit(step.steps, depth + 1);
    }
  };
  visit(steps, 0);
  return safeSteps;
}

function failureType(result: TestResult): FailureRecord["failureType"] {
  if (result.status === "timedOut") return "timeout";
  const firstName = result.errors[0]?.name;
  if (firstName === "TimeoutError") return "timeout";
  if (
    firstName === "ExpectError" ||
    firstName === "AssertionError" ||
    firstName === "ExpectationError"
  ) {
    return "assertion";
  }
  if (result.status === "failed" && firstName) return "runtime";
  return "unknown";
}

function currentRevision(): string | undefined {
  return process.env.RELEASE_REVISION?.trim() || captureReleaseIdentity(repositoryRoot).revision;
}

function debugOutput(): DebugOutput | undefined {
  if (process.env.CI !== "true") return undefined;

  const configured = process.env.PLAYWRIGHT_COMPATIBILITY_DEBUG_DIR?.trim();
  const runnerTemp = process.env.RUNNER_TEMP?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const attemptText = process.env.GITHUB_RUN_ATTEMPT?.trim();
  const revision = currentRevision();
  if (
    !configured ||
    !runnerTemp ||
    !isAbsolute(configured) ||
    !runId ||
    !/^\d+$/.test(runId) ||
    !attemptText ||
    !/^\d+$/.test(attemptText) ||
    !revision
  ) {
    return undefined;
  }

  const runnerRoot = resolve(runnerTemp);
  const directory = resolve(configured);
  const relativeDirectory = relative(runnerRoot, directory);
  if (
    !relativeDirectory ||
    relativeDirectory.includes(sep) ||
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory) ||
    !basename(directory).startsWith(OUTPUT_PREFIX)
  ) {
    return undefined;
  }

  return {
    directory,
    revision,
    runId,
    attempt: Number(attemptText),
  };
}

async function safeScreenshotBytes(
  failure: FailureRecord,
  playwrightOutputDir: string,
): Promise<Buffer | undefined> {
  try {
    const screenshot =
      failure.screenshotBody ??
      (failure.screenshotPath
        ? await (async () => {
            const outputRoot = await realpath(playwrightOutputDir);
            const screenshotPath = await realpath(failure.screenshotPath!);
            const relativePath = relative(outputRoot, screenshotPath);
            if (
              !relativePath ||
              relativePath === ".." ||
              relativePath.startsWith(`..${sep}`) ||
              isAbsolute(relativePath)
            ) {
              return undefined;
            }
            return readFile(screenshotPath);
          })()
        : undefined);
    return screenshot ? sanitizePngScreenshot(screenshot) : undefined;
  } catch {
    return undefined;
  }
}

export default class CompatibilityDebugReporter implements Reporter {
  private readonly failures = new Map<string, FailureRecord>();
  private playwrightOutputDir = "";

  onBegin(config: FullConfig): void {
    this.playwrightOutputDir = config.outputDir;
  }

  onTestEnd(testCase: TestCase, result: TestResult): void {
    const projectName = testCase.parent.project()?.name;
    if (!ALLOWED_PROJECTS.has(projectName ?? "")) return;
    if (
      (result.status !== "failed" && result.status !== "timedOut") ||
      result.status === testCase.expectedStatus
    ) {
      this.failures.delete(testCase.id);
      return;
    }
    if (this.failures.size >= MAX_FAILURES && !this.failures.has(testCase.id)) return;

    const screenshot = result.attachments.find(
      (attachment) =>
        attachment.name === SAFE_SCREENSHOT_ATTACHMENT &&
        attachment.contentType === "image/png",
    );
    const testId = SAFE_TEST_IDS.get(testCase.title) ?? "unmapped-test";
    const location = safeLocation(testCase.location);

    this.failures.set(testCase.id, {
      project: projectName as FailureRecord["project"],
      testId,
      status: result.status,
      failureType: failureType(result),
      durationMs: boundedDuration(result.duration),
      ...(location ? { location } : {}),
      steps: collectSafeSteps(result.steps),
      ...(screenshot?.path ? { screenshotPath: screenshot.path } : {}),
      ...(screenshot?.body ? { screenshotBody: screenshot.body } : {}),
    });
  }

  async onEnd(_result: FullResult): Promise<void> {
    const failures = [...this.failures.values()];
    if (failures.length === 0) return;
    const output = debugOutput();
    if (!output || !this.playwrightOutputDir) return;

    try {
      const outputRoot = await realpath(process.env.RUNNER_TEMP!);
      const outputDirectory = resolve(output.directory);
      const relativeOutput = relative(outputRoot, outputDirectory);
      if (
        !relativeOutput ||
        relativeOutput.includes(sep) ||
        relativeOutput === ".." ||
        relativeOutput.startsWith(`..${sep}`) ||
        isAbsolute(relativeOutput)
      ) {
        return;
      }

      await mkdir(outputDirectory);
      const actualOutputDirectory = await realpath(outputDirectory);
      if (actualOutputDirectory !== outputDirectory) return;
      const serialized: SerializedFailure[] = [];
      for (const [index, failure] of failures.entries()) {
        const id = `failure-${String(index + 1).padStart(2, "0")}`;
        const screenshot = await safeScreenshotBytes(
          failure,
          this.playwrightOutputDir,
        );
        let screenshotName: string | undefined;
        if (screenshot) {
          screenshotName = `${failure.project}-${id}.png`;
          await writeFile(resolve(actualOutputDirectory, screenshotName), screenshot, {
            flag: "wx",
          });
        }
        serialized.push({
          project: failure.project,
          testId: failure.testId,
          status: failure.status,
          failureType: failure.failureType,
          durationMs: failure.durationMs,
          ...(failure.location ? { location: failure.location } : {}),
          steps: failure.steps,
          id,
          ...(screenshotName ? { screenshot: screenshotName } : {}),
        });
      }

      await writeFile(
        resolve(actualOutputDirectory, "trace-summary.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            browser: "webkit",
            result: "failed",
            failureCount: serialized.length,
            failures: serialized,
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await writeFile(
        resolve(actualOutputDirectory, "manifest.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            artifact: "responsive-webkit-debug",
            workflowRunId: output.runId,
            workflowAttempt: output.attempt,
            revision: output.revision,
            environment: "isolated-disposable-ci-fixture",
            sanitizerVersion: 1,
            retentionDays: 3,
            result: "failed",
            failureCount: serialized.length,
            sanitizedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    } catch {
      console.error(
        "Sanitized responsive WebKit diagnostics were not retained; raw browser files were not uploaded.",
      );
    }
  }
}