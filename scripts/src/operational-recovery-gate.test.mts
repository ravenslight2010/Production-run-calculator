import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Computed import keeps this harness contract test outside application build
// references. These are transport-unit checks, not browser/API acceptance proof.
const fixtureModule = new URL(
  "../../artifacts/run-calculator/e2e/operationalRecoveryFixtures.ts",
  import.meta.url,
);
const { installManualFetchGate, releaseAndCaptureManualFetchGate } =
  await import(fixtureModule.href);

for (const requestInput of [false, true]) {
  test(`gate preserves original ${requestInput ? "Request" : "URL/init"} arguments and real response`, async (t) => {
    const response = Response.json({ code: "section_changed" }, { status: 409 });
    const url = "http://fixture.invalid/api/sync/manual-section?today=2026-01-01";
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "claim-1", runId: "run-1", section: "dough" }),
    };
    const input = requestInput ? new Request(url, init) : url;
    const actualInit = requestInput ? undefined : init;
    let dispatches = 0;
    const fakeWindow = {
      location: { href: "http://fixture.invalid/" },
      fetch: async (received: unknown, options: unknown) => {
        dispatches++;
        assert.equal(received, input, "do not replace arguments passed to installed wrappers");
        assert.equal(options, actualInit);
        if (received instanceof Request) assert.equal(received.bodyUsed, false);
        return response;
      },
    };
    const globals = globalThis as unknown as { window?: unknown };
    const prior = globals.window;
    globals.window = fakeWindow;
    t.after(() => { if (prior === undefined) delete globals.window; else globals.window = prior; });
    const page = {
      evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => fn(arg),
      waitForFunction: async (fn: () => unknown) => {
        const deadline = Date.now() + 1_000;
        while (!fn()) {
          assert.ok(Date.now() < deadline, "gate must settle without browser event correlation");
          await delay(1);
        }
      },
    };
    await installManualFetchGate(page);
    const delivery = fakeWindow.fetch(input, actualInit);
    assert.equal(dispatches, 0);
    const result = await releaseAndCaptureManualFetchGate(page);
    assert.equal(await delivery, response, "return the original unmodified Response");
    assert.equal(dispatches, 1);
    assert.equal(result.request.id, "claim-1");
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.response.json, { code: "section_changed" });
    assert.equal(result.transportError, undefined);
    assert.deepEqual(await response.json(), { code: "section_changed" }, "inspection must not consume the response");
  });
}
