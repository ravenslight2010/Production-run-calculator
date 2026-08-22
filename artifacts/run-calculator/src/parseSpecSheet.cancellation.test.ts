import { describe, expect, it } from "vitest";
import { makeParseCallPacer } from "./parseSpecSheet";

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
});