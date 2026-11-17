import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { captureReleaseIdentity } from "../../../scripts/src/release-source-identity.mjs";
import { claimBrowserAttempt, startBrowserAttempt } from "../../../scripts/src/browser-attempt-progress.mjs";
import {
  assertWebKitCaseIdentityContract,
  assertWebKitCompatibilityCaseIdentityContract,
} from "../../../scripts/src/webkit-case-contract.mts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
type Lane = "webkit-smoke" | "webkit-compatibility" | "webkit-compatibility-debug";
export const webkitCaseIdentity = (test: TestCase, responsive: boolean): string =>
  `${relative(root, test.location.file).replaceAll("\\", "/")} :: ${
    [ ...(responsive ? [test.parent.project()?.name ?? ""] : []),
      ...test.titlePath().slice(3) ].join(" › ")}`;

/** Independent observer only: never adopts passes or changes execution budgets. */
export class WebKitAttemptProgress {
  private progress?: ReturnType<typeof claimBrowserAttempt>;
  private selected = new Set<string>();
  private reviewed = false;

  constructor(private readonly lane: Lane) {}

  begin(config: FullConfig, suite: Suite): void {
    if (process.argv.includes("--list")) return;
    const identity = captureReleaseIdentity(root);
    if (process.env.RELEASE_REVISION && process.env.RELEASE_REVISION !== identity.revision)
      throw new Error("WebKit attempt source/test identity differs from the requested revision.");
    const key = this.lane === "webkit-compatibility-debug"
      ? "RELEASE_WEBKIT_DEBUG_ATTEMPT_ID" : "RELEASE_WEBKIT_ATTEMPT_ID";
    const attemptId = process.env[key] || startBrowserAttempt({ root, identity, lane: this.lane });
    this.progress = claimBrowserAttempt({ root, identity, attemptId, lane: this.lane });
    const tests = suite.allTests().filter((test) => this.lane !== "webkit-compatibility-debug" ||
      ["phone-webkit", "tablet-webkit"].includes(test.parent.project()?.name ?? ""));
    this.selected = new Set(tests.map((test) => test.id));
    const responsive = this.lane !== "webkit-smoke";
    const cases = tests.map((test) => ({
      id: test.id, projectName: test.parent.project()?.name ?? "",
      identity: webkitCaseIdentity(test, responsive), timeoutMs: test.timeout, retries: test.retries,
    }));
    // Persist discovered inventory even if it cannot satisfy the reviewed contract.
    this.progress.begin(cases, config);
    try {
      if (responsive) {
        // FullConfig keeps every configured project even with --project filters.
        // The discovered suite, not that unfiltered configuration, is execution
        // inventory. Its exact project-qualified identities are the fence.
        assertWebKitCompatibilityCaseIdentityContract(cases.map((test) => test.identity));
      } else {
        if (cases.some((test) => test.projectName !== "webkit")) return;
        assertWebKitCaseIdentityContract(cases.map((test) => test.identity));
      }
      this.reviewed = true;
    } catch {
      // A diagnostic attempt may enumerate an unreviewed subset; never promote it.
      this.reviewed = false;
    }
  }

  testBegin(test: TestCase, result: TestResult): void {
    if (this.selected.has(test.id)) this.progress?.testBegin(test.id, result);
  }
  testEnd(test: TestCase, result: TestResult): void {
    if (this.selected.has(test.id)) this.progress?.testEnd(test.id, result);
  }
  error(): void { this.progress?.error(); }
  end(result: FullResult): boolean {
    if (!this.progress) return false;
    return this.progress.end(result.status, captureReleaseIdentity(root), this.reviewed) &&
      this.reviewed && result.status !== "interrupted" && result.status !== "timedout";
  }
}
