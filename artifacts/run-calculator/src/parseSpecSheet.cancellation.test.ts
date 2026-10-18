import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { submitSpy } = vi.hoisted(() => ({ submitSpy: vi.fn() }));
vi.mock("./serverJobs", () => ({ submitAndWaitForServerJob: submitSpy }));
import {
  JOB_BACKED_PARSE_CHARS,
  makeParseCallPacer,
  ParseSpecAuthorizationError,
  requestParseSpecSheet,
} from "./parseSpecSheet";

beforeEach(() => submitSpy.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("spec import cancellation", () => {
  it("interrupts rate-limit pacing instead of waiting for the full window", async () => {
    const controller = new AbortController();
    const pace = makeParseCallPacer({
      windowMs: 60_000,
      maxCalls: 1,
      now: () => 0,
      signal: controller.signal,
    });

    await pace();
    const waiting = pace();
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([401, 403] as const)("does not fall back after a job authorization failure (%s)", async (status) => {
    submitSpy.mockRejectedValueOnce(new Error(`Server job submission failed (${status})`));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(requestParseSpecSheet({
      workbookText: "x".repeat(JOB_BACKED_PARSE_CHARS),
    })).rejects.toBeInstanceOf(ParseSpecAuthorizationError);

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});