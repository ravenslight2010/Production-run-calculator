/**
 * E2E: Case counter catch-up after screen-off / wake (tablet lifecycle test)
 *
 * Exercises the real browser clock/render lifecycle that unit tests cannot:
 *   – useClock pauses its setInterval when document.hidden=true
 *   – On visibilitychange (hidden → visible) useClock immediately calls
 *     setNowTime(new Date()), snapping the clock forward by the full off-duration
 *   – useAutoTrack then applies the FULL accumulated delta in ONE tick
 *     (old 2-case-per-tick cap removed; math unit-tested in tests 6 & 7 of
 *     useAutoTrack.pauseResume.test.ts)
 *
 * Clock strategy (avoids page.clock.install() timer-storm):
 *   page.clock.install() replaces ALL browser timers including the SSE
 *   reconnection setTimeout, causing the sync layer to stall for 60 s.
 *   Instead we use a lightweight Date Proxy (patches only Date.now / new Date,
 *   not setInterval/setTimeout) combined with document.hidden simulation:
 *     1. simulateScreenOff → document.hidden=true → useClock clears interval.
 *     2. mockDateNow(fakeMs) → Proxy wraps window.Date; new Date() returns fakeMs.
 *     3. simulateWake → visibilitychange → useClock calls setNowTime(new Date())
 *        which returns the mocked time, snapping React's nowTime forward.
 *     4. useAutoTrack's effect fires, computes delta from mocked nowTime, and
 *        writes skidsCompleted/casesOnCurrentSkid via form.setValue in one shot.
 *
 * Form setup:
 *   casesNeeded=200 (set via the always-visible Target Cases input in the header)
 *   cycleSpeed=30, crustsPerCycle=2  → ppm=60 pizza/min
 *   pizzasPerCase=6                  → casePeriod = 6 s
 *   freezerTime=5 min, casesPerSkid=10
 *   These NumFields are rendered unconditionally in the setup panel — the
 *   force: true fill bypasses visibility while still firing React's onChange.
 *
 *   At t=15 min from startedAt: afterTunnel=10 → expectedRaw=floor(10×60/6)=100
 *   At t=20 min from startedAt: afterTunnel=15 → expectedRaw=floor(15×60/6)=150
 *   Second-wake delta = 150 − 100 = 50 cases in ONE tick (old cap was 2).
 *
 * Two scenarios:
 *   A. Running run: counter jumps by full 50-case delta in second wake tick.
 *   B. Paused run: counter stays frozen after screen-off + clock advance + wake.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/hooks/useClock.ts
 *   artifacts/run-calculator/src/hooks/useAutoTrack.ts
 *   artifacts/run-calculator/src/hooks/__tests__/useAutoTrack.pauseResume.test.ts
 *   docs/screen-off-wake-test-protocol.md  (manual tablet test protocol)
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://<dev-domain> \
 *   STAFF_SIGNUP_CODE=<code> \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *   pnpm --filter @workspace/run-calculator exec playwright test screen-off-wake
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client as PgClient } from "pg";
import { computeCasesOnLine } from "@workspace/inventory-math";
import { cleanupTestUsers, requireIsolatedTestDatabase } from "./isolation";

// ── config ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2esow${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new PgClient({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

// ── auth helpers ──────────────────────────────────────────────────────────────

/**
 * Sign up via the browser /sign-up page, then dismiss the "Get Started"
 * onboarding dialog that auto-opens on first login.
 *
 * Uses waitFor (not isVisible) so the 5-second patience window catches dialogs
 * that appear slightly after the app's startup effects complete.
 */
async function signUpAndDismissDialog(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

  // "Get Started" dialog always auto-opens on first login.
  const getStartedBtn = page.getByRole("button", { name: /get.?started/i });
  try {
    await getStartedBtn.waitFor({ state: "visible", timeout: 8_000 });
    await getStartedBtn.click();
    await page.locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 5_000 });
    await page.waitForTimeout(300);
  } catch {
    // Dialog did not appear — page is already clear.
  }
}

async function promoteCurrentPageUserToManager(page: Page): Promise<void> {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me");
    return response.ok ? await response.json() as { userId?: string } : null;
  });
  const userId = identity?.userId;
  expect(userId, "signed-in test user id").toBeTruthy();
  const client = new PgClient({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("UPDATE user_roles SET role = 'manager' WHERE user_id = $1", [userId]);
  await client.end();
}

// ── form helpers ──────────────────────────────────────────────────────────────

/**
 * Populate form values required for useAutoTrack to tick.
 *
 * Uses the native HTMLInputElement.prototype.value setter + bubbling 'input'
 * and 'change' events — the React Testing Library pattern for writing to
 * react-hook-form controlled inputs.  The Line Setup accordion is opened
 * first so all NumField inputs are in an expanded subtree.
 *
 * Values applied:
 *   casesNeeded=200, cycleSpeed=30, crustsPerCycle=2, pizzasPerCase=6,
 *   casesPerSkid=10, freezerTime=5, doughballsPerTray=2,
 *   doughBatchYield=4
 *
 * Derived constants:
 *   ppm = 30 × 2 = 60 pizza/min → casePeriod = 6 pizzas / 60 ppm = 6 s/case
 *   At t=15 min: afterTunnel=10 → expectedRaw = floor(600/6) = 100 cases
 *   At t=20 min: afterTunnel=15 → expectedRaw = floor(900/6) = 150 cases
 *
 * After setting values, DOM assertions confirm all eight inputs hold the
 * expected numbers before returning.
 */
async function fillFormValues(page: Page, casesPerSkid = "10"): Promise<void> {
  // Step 1 — confirm the run is pending before touching any inputs
  await page
    .locator('[data-testid="button-start-run"]')
    .waitFor({ state: "visible", timeout: 10_000 });

  // Step 2 — open the "Line Setup" collapsible section
  // The <summary> element is always clickable (its parent content may have
  // pointer-events-none for non-supervisors, but the summary itself does not).
  const lineSetupDetails = page.locator("details").filter({
    has: page.locator("summary", { hasText: /line.?setup/i }),
  });
  await lineSetupDetails.first().waitFor({ state: "attached", timeout: 5_000 });
  const isOpen = await lineSetupDetails.first().evaluate(
    (el) => (el as HTMLDetailsElement).open,
  );
  if (!isOpen) {
    await lineSetupDetails.locator("summary").first().click();
    await page.waitForTimeout(200); // CSS transition
  }

  // Step 3 — set values via native setter + bubbling events
  // (React Testing Library's proven pattern for controlled inputs)
  const results: Record<string, boolean> = await page.evaluate((requestedCasesPerSkid) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!nativeSetter) return {};

    function fireChange(el: HTMLInputElement | null, value: string): boolean {
      if (!el) return false;
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const hit: Record<string, boolean> = {};

    // casesNeeded: found via "Target Cases" label → nearest .w-32 ancestor
    const tcLabel = Array.from(document.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === "Target Cases",
    );
    if (tcLabel) {
      const container = tcLabel.closest(".w-32") as HTMLElement | null;
      const input =
        container?.querySelector<HTMLInputElement>('input[type="number"]') ??
        null;
      hit["casesNeeded"] = fireChange(input, "200");
    } else {
      hit["casesNeeded"] = false;
    }

    // NumFields inside the Line Setup accordion
    const fields: Array<[string, string]> = [
      ["input-cycleSpeed", "30"],
      ["input-crustsPerCycle", "2"],
      ["input-pizzasPerCase", "6"],
      ["input-casesPerSkid", requestedCasesPerSkid],
      ["input-freezerTime", "5"],
      ["input-doughballsPerTray", "2"],
      ["input-doughBatchYield", "4"],
    ];
    for (const [testId, value] of fields) {
      const el = document.querySelector<HTMLInputElement>(
        `[data-testid="${testId}"]`,
      );
      hit[testId] = fireChange(el ?? null, value);
    }

    return hit;
  }, casesPerSkid);

  // Step 4 — fail immediately if any element was not found in the DOM
  const missing = Object.entries(results)
    .filter(([, found]) => !found)
    .map(([k]) => k);
  expect(
    missing,
    `Required form elements not found in DOM — cannot proceed: ${missing.join(", ")}`,
  ).toHaveLength(0);

  // Give react-hook-form time to propagate values through its watch() chain
  await page.waitForTimeout(600);

  // Step 5 — assert every value is present in the DOM before starting the run
  const domValues = await page.evaluate(() => {
    function val(testId: string): string {
      return (
        document
          .querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
          ?.value.trim() ?? "NOT_FOUND"
      );
    }
    const tcLabel = Array.from(document.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === "Target Cases",
    );
    const container = tcLabel?.closest(".w-32") as HTMLElement | null;
    const casesNeededVal =
      container
        ?.querySelector<HTMLInputElement>('input[type="number"]')
        ?.value.trim() ?? "NOT_FOUND";
    return {
      casesNeeded: casesNeededVal,
      cycleSpeed: val("input-cycleSpeed"),
      crustsPerCycle: val("input-crustsPerCycle"),
      pizzasPerCase: val("input-pizzasPerCase"),
      casesPerSkid: val("input-casesPerSkid"),
      freezerTime: val("input-freezerTime"),
      doughballsPerTray: val("input-doughballsPerTray"),
      doughBatchYield: val("input-doughBatchYield"),
    };
  });

  expect(domValues.casesNeeded, "casesNeeded not set in DOM").toBe("200");
  expect(domValues.cycleSpeed, "cycleSpeed not set in DOM").toBe("30");
  expect(domValues.crustsPerCycle, "crustsPerCycle not set in DOM").toBe("2");
  expect(domValues.pizzasPerCase, "pizzasPerCase not set in DOM").toBe("6");
  expect(domValues.casesPerSkid, "casesPerSkid not set in DOM").toBe(casesPerSkid);
  expect(domValues.freezerTime, "freezerTime not set in DOM").toBe("5");
  expect(domValues.doughballsPerTray, "doughballsPerTray not set in DOM").toBe("2");
  expect(domValues.doughBatchYield, "doughBatchYield not set in DOM").toBe("4");
}

// ── clock / visibility helpers ────────────────────────────────────────────────

/**
 * Install the document.hidden mock.
 * Does NOT replace setInterval/setTimeout — SSE reconnection is unaffected.
 */
async function installHiddenMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__testHidden = false;
    Object.defineProperty(document, "hidden", {
      get: () =>
        (window as unknown as Record<string, unknown>).__testHidden ?? false,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      get: () =>
        (window as unknown as Record<string, unknown>).__testHidden
          ? "hidden"
          : "visible",
      configurable: true,
    });
  });
}

/** Simulate screen-off: mark hidden + dispatch visibilitychange. */
async function simulateScreenOff(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__testHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * Simulate wake: mark visible + dispatch visibilitychange + focus.
 * useClock's handler sees !document.hidden → calls setNowTime(new Date()),
 * which returns the mocked time, snapping the React clock forward in one shot.
 */
async function simulateWake(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus")); // Android-tablet fallback in useClock
  });
}

/**
 * Lightweight Date Proxy: intercepts BOTH `new Date()` (no-arg) and
 * `Date.now()` to return `fakeMs`.
 *
 * We must mock both because:
 *   • `startedAt` is stamped via `Date.now()` in handleStartRun() — we need
 *     to control it so the elapsed-time math is exact.
 *   • `useClock` uses `new Date()` — we need it to see the fake nowTime so
 *     `useAutoTrack` receives the right elapsed duration on wake.
 *
 * The base time is always set to 21:00 UTC of today, so mock offsets of
 * +15 min and +20 min land at 21:15 and 21:20 UTC — never near midnight.
 * `todayStr()` uses `new Date()` internally; as long as the mock stays on
 * the same calendar date, it returns today's date and the daily auth reset
 * is not triggered.
 *
 * The proxy is installed once per page (idempotent).  Subsequent calls just
 * update `__testFakeMs` — no proxy stacking.  Does NOT freeze timers.
 */
async function mockDateNow(page: Page, fakeMs: number): Promise<void> {
  await page.evaluate((ms) => {
    const w = window as unknown as Record<string, unknown>;
    w.__testFakeMs = ms;
    if (w.__testDateProxyInstalled) return; // already installed; just update ms
    w.__testDateProxyInstalled = true;
    const Orig = window.Date;
    w.__origDate = Orig;
    window.Date = new Proxy(Orig, {
      construct(target, args) {
        return args.length === 0
          ? new target((w.__testFakeMs as number))
          : Reflect.construct(target, args);
      },
      apply(target, _self, args) {
        return args.length === 0
          ? new target((w.__testFakeMs as number)).toString()
          : Reflect.apply(target, target, args);
      },
      get(target, prop, receiver) {
        if (prop === "now") return () => (w.__testFakeMs as number);
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    }) as unknown as typeof Date;
  }, fakeMs);
}

/**
 * Restore the original Date object.
 * Call this only at the very end of a test (or not at all — each test uses
 * an isolated page context that is closed after the test).  Never call this
 * mid-test: restoring real time can make `Date.now()` jump past midnight and
 * trigger the daily auth reset, logging the user out.
 */
async function restoreDate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const orig = w.__origDate as typeof Date | undefined;
    if (orig) {
      window.Date = orig;
      w.__testDateProxyInstalled = false;
    }
  });
}

// ── assertion helpers ─────────────────────────────────────────────────────────

/**
 * Read calc.casesCompleted from the tile-cases-completed element.
 * Visible whenever casesNeeded > 0 — fillFormValues sets casesNeeded=200.
 */
async function readCaseTotal(page: Page): Promise<number> {
  const text = await page
    .locator('[data-testid="tile-cases-completed"]')
    .textContent({ timeout: 6_000 });
  return parseInt((text ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
}

async function readCasesOnLine(page: Page): Promise<number> {
  const text = await page
    .locator('[data-testid="cases-on-line-value"]')
    .first()
    .textContent({ timeout: 6_000 });
  return Number((text ?? "0").replace(/[^0-9]/g, "")) || 0;
}

/**
 * Wait until tile-cases-completed differs from prevTotal.
 * Uses real-time Playwright polling — unaffected by any Date mock.
 */
async function waitForCaseCounterChange(
  page: Page,
  prevTotal: number,
  timeoutMs = 7_000,
): Promise<void> {
  await page.waitForFunction(
    ({ prev }: { prev: number }) => {
      const el = document.querySelector(
        '[data-testid="tile-cases-completed"]',
      ) as HTMLElement | null;
      if (!el) return false;
      const val = parseInt((el.textContent ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
      return val !== prev;
    },
    { prev: prevTotal },
    { timeout: timeoutMs },
  );
}

/** Set the measured machine times used by the live dough countdowns. */
async function setMachineTimes(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const values: Record<string, string> = {
      "input-mixerLowSec": "1",
      "input-mixerHighSec": "1",
      "input-hopperSec": "2",
    };
    const changed: string[] = [];
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) return changed;
    for (const [testId, value] of Object.entries(values)) {
      const input = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLInputElement | null;
      if (!input) continue;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      changed.push(testId);
    }
    return changed;
  });
  expect(result, "machine timing inputs").toEqual([
    "input-mixerLowSec",
    "input-mixerHighSec",
    "input-hopperSec",
  ]);
}

async function readDoughCounters(page: Page): Promise<{
  trays: number;
  batches: number;
}> {
  return page.evaluate(() => {
    const value = (name: string) =>
      Number((document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? 0);
    return {
      trays: value("traysOnLine"),
      batches: value("batchesReady"),
    };
  });
}

/** Seed visible dough inventory through the same form events as an operator. */
async function seedDoughCounters(
  page: Page,
  counters: { trays: number; batches: number },
): Promise<void> {
  const result = await page.evaluate(({ trays, batches }) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const changed: string[] = [];
    if (!setter) return changed;
    for (const [name, value] of [
      ["traysOnLine", String(trays)],
      ["batchesReady", String(batches)],
    ] as const) {
      const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input) continue;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      changed.push(name);
    }
    return changed;
  }, counters);
  expect(result, "dough inventory inputs").toEqual(["traysOnLine", "batchesReady"]);
  await page.waitForTimeout(500);
  await expect.poll(() => readDoughCounters(page)).toEqual(counters);
}

// ── shared setup ──────────────────────────────────────────────────────────────

/**
 * Full setup for one test:
 *   1. Sign up via browser and dismiss the onboarding dialog.
 *   2. Navigate to the Run tab.
 *   3. Fill form values (cycleSpeed=30, crustsPerCycle=2, pizzasPerCase=6,
 *      casesPerSkid=10, freezerTime=5, casesNeeded=200).
 *   4. Install the Date proxy and hidden mock BEFORE clicking Start Run,
 *      anchored to 21:00 UTC today so that mock offsets (+15 min, +20 min)
 *      always land at 21:15 / 21:20 UTC — never near midnight.
 *      This ensures:
 *        • startedAt = Date.now() = safeBaseMs (exact, no timing jitter)
 *        • todayStr() = new Date() stays on the same calendar day (no reset)
 *        • The daily auth-reset never fires during the mocked window
 *   5. Click START RUN; app sets startedAt = Date.now() = safeBaseMs.
 *   6. Wait for tile-cases-completed (confirms casesNeeded > 0 and run live).
 * Returns safeBaseMs, which is the exact startedAt the app stored.
 */
async function setupAndStartRun(page: Page, casesPerSkid = "10"): Promise<number> {
  const username = uid();
  testUsernames.add(username);
  await signUpAndDismissDialog(page, username, "TestPass123!");

  await page.locator('[data-testid="tab-run"]').click();
  await fillFormValues(page, casesPerSkid);

  // Compute a safe anchor time: 21:00 UTC today.
  // mock offsets of +15 min → 21:15 and +20 min → 21:20 — well clear of midnight.
  const safeBase = new Date();
  safeBase.setUTCHours(21, 0, 0, 0);
  const safeBaseMs = safeBase.getTime();

  // Install the hidden-doc mock and date proxy BEFORE Start Run so the app's
  // handleStartRun() reads Date.now() = safeBaseMs → startedAt = safeBaseMs.
  await installHiddenMock(page);
  await mockDateNow(page, safeBaseMs);
  // Force useClock to snap nowTime → safeBaseMs immediately (don't wait for
  // the next 1-second interval tick).
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(150); // let React setState(safeBaseMs) commit

  // START RUN is visible when runStatus === "pending"
  await page.locator('[data-testid="button-start-run"]')
    .waitFor({ state: "visible", timeout: 20_000 });

  await page.locator('[data-testid="button-start-run"]').click();

  // Both PAUSE RUN and STOP RUN appear; .first() avoids strict-mode error
  await page
    .getByRole("button", { name: /stop.?run|pause.?run/i })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });

  // tile-cases-completed renders when casesNeeded > 0 (we set it to 200).
  // With mock time = safeBaseMs = startedAt, elapsedMin = 0, afterTunnel = 0,
  // expectedCases = 0 — the tile shows "0 / 200".
  await page
    .locator('[data-testid="tile-cases-completed"]')
    .waitFor({ state: "visible", timeout: 10_000 });

  return safeBaseMs; // exact value the app stored as startedAt
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("screen-off / wake — case counter lifecycle", () => {
  /**
   * Clear today's factory-wide daily_sync row before each test.
   *
   * daily_sync is scoped per factory-date (not per user).  After Test A starts
   * a run and syncs it, Test B's fresh user would inherit the running run on
   * startup, making runStatus !== "pending" before the test reaches Start Run.
   *
   * global-setup.ts performs the same DELETE once before the whole suite.
   * This beforeEach mirrors that logic on a per-test basis to prevent
   * cross-test state leakage within the file.
   *
   * Safety guard: this is a destructive fixture and must use the same
   * local/disposable database boundary as global-setup.ts.
   */
  test.beforeEach(async () => {
    const url = requireIsolatedTestDatabase("screen-off-wake beforeEach");
    const client = new PgClient({ connectionString: url });
    try {
      await client.connect();
      const today = new Date().toISOString().slice(0, 10);
      await client.query("DELETE FROM daily_sync WHERE date = $1", [today]);
    } finally {
      await client.end().catch(() => {});
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A. Running run: the case counter jumps by the full 50-case delta in ONE
  //    wake tick — the old 2-case-per-tick cap is confirmed removed.
  //
  //  Formula (useAutoTrack.ts lines 286-290):
  //    elapsedMinAfterTunnel = max(0, elapsedMin − freezerTime)
  //    expectedCasesRaw      = floor(elapsedMinAfterTunnel × ppm / pizzasPerCase)
  //    ppm = cycleSpeed × crustsPerCycle × speedAdjustment = 30 × 2 × 1 = 60
  //    casePeriod = pizzasPerCase / ppm = 6 / 60 = 0.1 min/case = 6 s/case
  //
  //  setupAndStartRun() installs the Date proxy at safeBaseMs (21:00 UTC)
  //  BEFORE clicking Start Run, so startedAt = Date.now() = safeBaseMs exactly.
  //  There is NO timing jitter — all mock offsets are exact.
  //
  //  First wake  (t = safeBaseMs + 15 min):
  //    elapsedMin = 15 exactly → afterTunnel = 10 min → cases = 100 exactly
  //
  //  Second wake (t = safeBaseMs + 20 min):
  //    elapsedMin = 20 exactly → afterTunnel = 15 min → cases = 150 exactly
  //    delta = 150 − 100 = 50 in ONE tick
  //
  //  If the old 2-case-per-tick cap were still present, delta would be 2.
  //
  //  restoreDate() is NOT called mid-test: restoring real time would make
  //  Date.now() jump to the actual wall clock (potentially past midnight),
  //  triggering the daily auth reset and navigating to the sign-in page.
  //  Each test has its own page context which is closed after the test.
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "A. running run: counter jumps by full 50-case delta in one wake tick (no cap)",
    async ({ page }) => {
      const safeBaseMs = await setupAndStartRun(page);
      // Note: installHiddenMock + mockDateNow(safeBaseMs) already done in setup.

      // ── First wake: seed exactly 100 cases ──────────────────────────────
      // elapsed = 15 min exactly → afterTunnel = 10 min → floor(10×60/6) = 100
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 15 * 60_000);
      await simulateWake(page);
      await waitForCaseCounterChange(page, 0, 8_000);
      // Do NOT restoreDate here — see comment above.

      const casesBaseline = await readCaseTotal(page);
      expect(
        casesBaseline,
        `baseline after +15 min must be exactly 100; got ${casesBaseline}`,
      ).toBe(100);

      // ── Second wake: EXACTLY 50 more cases in ONE tick ──────────────────
      // elapsed = 20 min → afterTunnel = 15 min → floor(15×60/6) = 150
      // delta = 150 − 100 = 50 (old 2-case cap would give 2)
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 20 * 60_000);
      await simulateWake(page);
      await waitForCaseCounterChange(page, casesBaseline, 8_000);

      const casesAfterWake = await readCaseTotal(page);
      const delta = casesAfterWake - casesBaseline;

      expect(
        casesAfterWake,
        `total after +20 min must be exactly 150; got ${casesAfterWake}`,
      ).toBe(150);
      expect(
        delta,
        `delta must be exactly 50 (old 2-case cap would give 2); ` +
          `got Δ=${delta} (${casesBaseline}→${casesAfterWake})`,
      ).toBe(50);
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // B. Paused run: the case counter stays frozen on wake.
  //
  //  useAutoTrack.ts: the case-tick effect guards on
  //  `(runStatus === "running" || drainActive)` — paused satisfies neither,
  //  so the effect exits before writing to skidsCompleted/casesOnCurrentSkid.
  //
  //  Same midnight-safety approach as Test A (no mid-test restoreDate).
  // ──────────────────────────────────────────────────────────────────────────
  test(
    "B. paused run: counter stays frozen after screen-off + wake",
    async ({ page }) => {
      const safeBaseMs = await setupAndStartRun(page);

      // ── Baseline: running, +15 min → seeds exactly 100 cases ────────────
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 15 * 60_000);
      await simulateWake(page);
      await waitForCaseCounterChange(page, 0, 8_000);

      const casesBeforePause = await readCaseTotal(page);
      // elapsed = 15 min exactly → afterTunnel = 10 min → floor(10×60/6) = 100
      expect(
        casesBeforePause,
        `baseline before pause must be exactly 100; got ${casesBeforePause}`,
      ).toBe(100);

      // ── Pause the run ───────────────────────────────────────────────────
      const pauseBtn = page.getByRole("button", { name: /pause.?run/i }).first();
      await pauseBtn.waitFor({ state: "visible", timeout: 5_000 });
      await pauseBtn.click();
      await page.waitForTimeout(600);

      // ── Screen-off + clock advance + wake while paused ──────────────────
      // useAutoTrack.ts guard: `(runStatus === "running" || drainActive)`
      // Paused → neither true → early return → no write to case counter.
      // Do NOT call restoreDate here (see Test A comment on midnight safety).
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 20 * 60_000);
      await simulateWake(page);
      // Give React 2 s to settle — counter must NOT change.
      await page.waitForTimeout(2_000);

      const casesAfterPausedWake = await readCaseTotal(page);
      expect(
        casesAfterPausedWake,
        `paused wake: expected ${casesBeforePause}, got ${casesAfterPausedWake}`,
      ).toBe(casesBeforePause);
    },
  );

  test(
    "responsive display matches shared line occupancy while running, paused, and draining",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const safeBaseMs = await setupAndStartRun(page);
      const occupancy = {
        ppm: 60,
        pizzasPerCase: 6,
        freezerTimeMin: 5,
      };
      const expectedRunning = computeCasesOnLine({
        startedAt: safeBaseMs,
        now: safeBaseMs + 2 * 60_000,
        ...occupancy,
      });

      await mockDateNow(page, safeBaseMs + 2 * 60_000);
      await simulateScreenOff(page);
      await simulateWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedRunning);

      const pauseButton = page.getByRole("button", { name: /pause.?run/i }).first();
      await pauseButton.click();
      await page.waitForTimeout(500);

      const expectedPaused = computeCasesOnLine({
        startedAt: safeBaseMs,
        pausedAt: safeBaseMs + 2 * 60_000,
        now: safeBaseMs + 12 * 60_000,
        ...occupancy,
      });
      await mockDateNow(page, safeBaseMs + 12 * 60_000);
      await simulateScreenOff(page);
      await simulateWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedPaused);

      await page.getByRole("button", { name: /resume.?run/i }).first().click();
      await page.waitForTimeout(500);

      // Resuming shifts the effective start by the ten-minute pause. At the
      // original +15-minute wall time, the shared model has five live minutes.
      const resumedStartedAt = safeBaseMs + 10 * 60_000;
      const endedAt = safeBaseMs + 15 * 60_000;
      const expectedAtEnd = computeCasesOnLine({
        startedAt: resumedStartedAt,
        endedAt,
        now: endedAt,
        ...occupancy,
      });
      await mockDateNow(page, endedAt);
      await simulateScreenOff(page);
      await simulateWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedAtEnd);

      await page.getByRole("button", { name: /stop.?run/i }).first().click();
      await page.waitForTimeout(500);

      const expectedDraining = computeCasesOnLine({
        startedAt: resumedStartedAt,
        endedAt,
        now: endedAt + 3 * 60_000,
        ...occupancy,
      });
      await mockDateNow(page, endedAt + 3 * 60_000);
      await simulateScreenOff(page);
      await simulateWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedDraining);
    },
  );

  test(
    "D. pause, background sleep, and resume keep all live countdowns aligned",
    async ({ page }) => {
      const safeBaseMs = await setupAndStartRun(page);
      const initialCases = await readCaseTotal(page);
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page);
      // Deterministic populated fixture:
      //   2 doughballs/tray → tray cadence = 2 s at 60 ppm
      //   4 doughballs/batch and hopper=2 s → quarter-batch cadence = 1 s
      //   mixer=2 s → batch production cadence = 2 s
      // Start with both sources present so every write path is observable.
      await seedDoughCounters(page, { trays: 3, batches: 1 });
      await page.waitForTimeout(400);

      // These are the three visible dough stages plus both corresponding
      // machine/line countdowns. Their values are rendered from tickDueRefs,
      // so their presence is also a browser-level guard against a stale
      // countdown schedule after the form update.
      for (const label of [
        "1 · Prepped",
        "2 · Spinning",
        "3 · In Hopper",
      ]) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(page.getByText("Mixer finishes +1 in", { exact: true })).toBeVisible();
      await expect(page.getByText("Hopper finishes +1 in", { exact: true })).toBeVisible();

      const beforePause = {
        cases: initialCases,
        dough: await readDoughCounters(page),
      };
      expect(beforePause.dough).toEqual({ trays: 3, batches: 1 });

      const pauseButton = page.getByRole("button", { name: /pause.?run/i }).first();
      await pauseButton.click();
      await page.waitForTimeout(300);

      // A hidden tab can be throttled for much longer than a normal timer
      // period. Wake at +10 s, while paused: no channel may write, seed, or
      // consume during the paused interval.
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 10_000);
      await simulateWake(page);
      await page.waitForTimeout(800);

      expect(await readDoughCounters(page), "paused dough counters").toEqual(beforePause.dough);

      // Resume from the same mocked instant. The authoritative due refs must
      // re-arm from this instant; advancing one case period then permits one
      // case write, without replaying the hidden +10 s.
      const resumeButton = page.getByRole("button", { name: /resume.?run/i }).first();
      await resumeButton.click();
      await page.waitForTimeout(300);

      // Resume re-arms the dough schedules from the resume instant. At +1.1 s
      // only the quarter-batch drain is due: one write, no tray or mixer
      // production yet. The ten seconds spent paused must not be replayed.
      await mockDateNow(page, safeBaseMs + 11_100);
      await simulateScreenOff(page);
      await simulateWake(page);
      await page.waitForTimeout(500);
      expect(
        await readDoughCounters(page),
        "first resumed boundary should drain one quarter batch only",
      ).toEqual({ trays: 3, batches: 0.75 });

      // At +2.1 s, one tray production and one tray consumption coincide
      // (net zero), while mixer production adds one batch and the quarter
      // drain removes another 0.25. This catches duplicate production and
      // phantom catch-up writes from the hidden interval.
      await mockDateNow(page, safeBaseMs + 12_100);
      await simulateScreenOff(page);
      await simulateWake(page);
      await page.waitForTimeout(500);
      expect(
        await readDoughCounters(page),
        "second resumed boundary should pair tray writes and add one mixer batch",
      ).toEqual({ trays: 3, batches: 1.5 });
      // Replaying the same visibility event at the same mocked instant must
      // not duplicate any of the writes just observed.
      await simulateWake(page);
      await page.waitForTimeout(300);
      expect(await readDoughCounters(page), "duplicate wake writes").toEqual({
        trays: 3,
        batches: 1.5,
      });

      // The shared setup uses a five-minute freezer/tunnel window. Advance
      // beyond that window plus one six-second case period; the paused ten
      // seconds must still not be replayed as packaging production.
      await mockDateNow(page, safeBaseMs + 5 * 60_000 + 16_500);
      await simulateScreenOff(page);
      await simulateWake(page);
      await page.locator('[data-testid="tab-run"]').click();
      await waitForCaseCounterChange(page, beforePause.cases, 8_000);

      expect(
        await readCaseTotal(page),
        "resume should write one case period, not replay paused time",
      ).toBe(beforePause.cases + 1);
      // Dough counters are no longer on the Run tab; the exact boundaries
      // above prove their writes before this final packaging assertion.
    },
  );

  test(
    "C. disconnected sleeping peer adopts remote Stop before stale recovery writes and after reload",
    async ({ page, browser }: { page: Page; browser: Browser }) => {
      const profileBrand = `Wake ${uid()}`;
      const profileFlavor = "Peer Flavor";
      const profileKey = `${profileBrand.toLowerCase()}__${profileFlavor.toLowerCase()}`;
      const postProfile = async (frontlineRecipeName: string, updatedAt: number) => {
        const result = await page.evaluate(async ({ key, name, stamp, brand, flavor }) => {
          const res = await fetch("/api/brand-profiles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              items: [{
                key,
                brand,
                flavor,
                values: { frontlineRecipeName: name, app1Type: "Cheese" },
                crustValues: {},
                updatedAt: stamp,
              }],
            }),
          });
          return { ok: res.ok, status: res.status };
        }, {
          key: profileKey,
          name: frontlineRecipeName,
          stamp: updatedAt,
          brand: profileBrand,
          flavor: profileFlavor,
        });
        expect(result).toEqual({ ok: true, status: 200 });
      };

      const safeBaseMs = await setupAndStartRun(page);
      // This scenario exercises manager-only profile/factory APIs. Other
      // screen-wake cases intentionally run as floor staff.
      await promoteCurrentPageUserToManager(page);
      // Browser time is deliberately fixed at 21:00 for this clock suite.
      // Keep profile LWW stamps ahead of real Node time so the peer's mocked
      // clock cannot make an older remote profile look stale.
      const profileStamp = Date.now() + 4 * 60 * 60_000;
      await postProfile("Wake Sauce V1", profileStamp);

      // A second independent context has its own in-memory caches, but shares
      // this manager's authenticated cookie. It is the sleeping tablet.
      const peer = await browser.newContext({ storageState: await page.context().storageState() });
      try {
        const sleepingPage = await peer.newPage();
        await sleepingPage.goto("/", { waitUntil: "domcontentloaded" });
        await sleepingPage.locator('[data-testid="tab-run"]').waitFor({ state: "visible", timeout: 20_000 });
        await sleepingPage.getByRole("button", { name: /stop.?run/i }).first()
          .waitFor({ state: "visible", timeout: 15_000 });
        await sleepingPage.evaluate((key) => {
          localStorage.setItem(
            `run-calc-profile-${key}`,
            JSON.stringify({ frontlineRecipeName: "Wake Sauce V1", app1Type: "Cheese" }),
          );
        }, profileKey);
        await installHiddenMock(sleepingPage);
        await simulateScreenOff(sleepingPage);
        await peer.setOffline(true);
        await sleepingPage.waitForTimeout(300);

        const staleDayRaw = await sleepingPage.evaluate(() =>
          localStorage.getItem("run-calc-day"),
        );
        expect(staleDayRaw, "sleeping peer should persist its running copy").toBeTruthy();

        // Force a stale queued write while the sleeping browser is offline.
        // It carries the old running lifecycle and must be invalidated/rebuilt
        // after foreground reconciliation rather than retried after the Stop.
        await sleepingPage.locator('[data-testid="input-cycleSpeed"]').evaluate((el) => {
          const input = el as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          setter?.call(input, "31");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await sleepingPage.waitForTimeout(900);

        // Device A stops while B is genuinely disconnected and therefore cannot
        // receive the normal SSE lifecycle event.
        await mockDateNow(page, safeBaseMs + 60_000);
        await page.getByRole("button", { name: /stop.?run/i }).first().click();
        await page.waitForFunction(async () => {
          const response = await fetch(`/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`, {
            cache: "no-store",
          });
          const body = await response.json() as { dayState?: { runs?: Array<{ endedAt?: number }> } };
          return body.dayState?.runs?.some((run) => typeof run.endedAt === "number") ?? false;
        }, undefined, { timeout: 15_000 });
        await postProfile("Wake Sauce V2", profileStamp + 10_000);
        const factoryWrite = await page.evaluate(async () => {
          const res = await fetch("/api/factory-data", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: "run-calc-shift-start-time", value: "05:45" }),
          });
          return res.ok;
        });
        expect(factoryWrite).toBe(true);

        // Keep the recovered EventSource disconnected so the only path that can
        // adopt Stop is the explicit foreground GET.
        await sleepingPage.route("**/api/sync/events**", (route) => route.abort());
        await peer.setOffline(false);
        await simulateWake(sleepingPage);
        await sleepingPage.getByText("Ended", { exact: true }).first()
          .waitFor({ state: "visible", timeout: 15_000 });
        const casesAfterStop = await readCaseTotal(sleepingPage);
        await sleepingPage.waitForTimeout(2_000);
        expect(await readCaseTotal(sleepingPage)).toBe(casesAfterStop);
        await sleepingPage.waitForFunction(async ({ key }) => {
          const response = await fetch("/api/brand-profiles");
          const body = await response.json() as { items?: Array<{ key: string; values?: { frontlineRecipeName?: string } }> };
          return body.items?.some((item) => item.key === key && item.values?.frontlineRecipeName === "Wake Sauce V2") ?? false;
        }, { key: profileKey }, { timeout: 15_000 });
        const factoryRead = await sleepingPage.evaluate(async () => {
          const res = await fetch("/api/factory-data");
          const body = await res.json() as { data?: Record<string, { value?: unknown }> };
          return body.data?.["run-calc-shift-start-time"]?.value;
        });
        expect(factoryRead).toBe("05:45");

        // Let the captured retry window pass, then verify it did not replace the
        // authoritative Stop on the shared row.
        await sleepingPage.waitForTimeout(5_500);
        const sharedStillStopped = await page.evaluate(async () => {
          const res = await fetch(`/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`, {
            cache: "no-store",
          });
          const body = await res.json() as { dayState?: { runs?: Array<{ endedAt?: number }> } };
          return body.dayState?.runs?.some((run) => typeof run.endedAt === "number") ?? false;
        });
        expect(sharedStillStopped).toBe(true);
        await sleepingPage.getByText("Ended", { exact: true }).first()
          .waitFor({ state: "visible", timeout: 5_000 });

        // Recreate the old running disk copy and perform a full reload. The
        // authoritative strictly-newer Stop must win again without an operator
        // tapping Stop on this device.
        await sleepingPage.unroute("**/api/sync/events**");
        await sleepingPage.evaluate((raw) => {
          if (raw) localStorage.setItem("run-calc-day", raw);
        }, staleDayRaw);
        await sleepingPage.reload({ waitUntil: "domcontentloaded" });
        await sleepingPage.getByText("Ended", { exact: true }).first()
          .waitFor({ state: "visible", timeout: 15_000 });
      } finally {
        await peer.setOffline(false);
        await peer.close();
      }
    },
  );

  test(
    "D. active peers and server keep a downward skid correction over a stale automatic write",
    async ({ page, browser }: { page: Page; browser: Browser }) => {
      const safeBaseMs = await setupAndStartRun(page, "48");
      // Stay comfortably inside the 36-case bucket rather than exactly on its
      // opening millisecond; browser/start timestamp ordering can otherwise
      // leave floating-point elapsed time a fraction below 3.6 minutes.
      const baselineAt = safeBaseMs + 8 * 60_000 + 36_500;

      // At +8.6 min, 3.6 min of product has exited the five-minute tunnel:
      // floor(3.6 * 60 pizzas/min / 6 pizzas/case) = 36 cases.
      await simulateScreenOff(page);
      await mockDateNow(page, baselineAt);
      await simulateWake(page);
      await waitForCaseCounterChange(page, 0, 8_000);
      expect(await readCaseTotal(page)).toBe(36);

      // Wait until the automatic baseline and its generation-0 packaging
      // register are durably stored before the second active browser joins.
      await page.waitForFunction(async () => {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`/api/sync/today?today=${today}`);
        const body = await response.json() as {
          packagingProgress?: Record<string, { casesOnCurrentSkid?: number }>;
        } | null;
        return Object.values(body?.packagingProgress ?? {})
          .some((entry) => entry.casesOnCurrentSkid === 36);
      }, undefined, { timeout: 15_000 });

      const peer = await browser.newContext({
        storageState: await page.context().storageState(),
      });
      try {
        // Install the same Date proxy before any app script runs. Both tabs are
        // active and automatic tracking is enabled, but neither can race ahead
        // merely because this test's real clock differs from startedAt.
        await peer.addInitScript(({ fakeMs }) => {
          const w = window as unknown as Record<string, unknown>;
          w.__testFakeMs = fakeMs;
          w.__testDateProxyInstalled = true;
          const Orig = window.Date;
          w.__origDate = Orig;
          window.Date = new Proxy(Orig, {
            construct(target, args) {
              return args.length === 0
                ? new target(w.__testFakeMs as number)
                : Reflect.construct(target, args);
            },
            apply(target, _self, args) {
              return args.length === 0
                ? new target(w.__testFakeMs as number).toString()
                : Reflect.apply(target, target, args);
            },
            get(target, prop, receiver) {
              if (prop === "now") return () => w.__testFakeMs as number;
              const value = Reflect.get(target, prop, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }) as unknown as typeof Date;
        }, { fakeMs: baselineAt });

        const peerPage = await peer.newPage();
        await peerPage.goto("/", { waitUntil: "domcontentloaded" });
        await peerPage.locator('[data-testid="tile-cases-completed"]')
          .waitFor({ state: "visible", timeout: 20_000 });
        await expect.poll(() => readCaseTotal(peerPage), { timeout: 15_000 }).toBe(36);

        // Capture what the second active browser knew before the correction.
        // We later replay this as its unaware automatic tick with a newer
        // whole-run timestamp; the older correction generation must still lose.
        const staleSnapshot = await peerPage.evaluate(async () => {
          const today = new Date().toISOString().slice(0, 10);
          const response = await fetch(`/api/sync/today?today=${today}`);
          return await response.json() as {
            dayState?: { currentRunId?: string; runs?: Array<{ id?: string }> };
            runValues?: Record<string, Record<string, unknown>>;
            runValuesUpdatedAt?: Record<string, number>;
            packagingProgress?: Record<string, {
              skidsCompleted: number;
              casesOnCurrentSkid: number;
              correctionGeneration: number;
              updatedAt: number;
              manualOverrideUntil: number;
            }>;
          };
        });
        const runId =
          staleSnapshot.dayState?.currentRunId ??
          staleSnapshot.dayState?.runs?.[0]?.id;
        expect(runId, "active run id in stale peer snapshot").toBeTruthy();
        expect(staleSnapshot.packagingProgress?.[runId!]?.casesOnCurrentSkid).toBe(36);

        await page.locator('[data-testid="tab-packaging"]').click();
        await peerPage.locator('[data-testid="tab-packaging"]').click();
        const primaryCases = page.locator('[data-testid="text-casesOnCurrentSkid"]');
        const peerCases = peerPage.locator('[data-testid="text-casesOnCurrentSkid"]');
        await expect(primaryCases).toHaveText("36");
        await expect(peerCases).toHaveText("36");

        // Explicit operator correction: 36/48 → 24/48.
        const decrement = page.locator('[data-testid="btn-dec-casesOnCurrentSkid"]');
        for (let i = 0; i < 12; i++) await decrement.click();
        await expect(primaryCases).toHaveText("24");
        await expect(peerCases).toHaveText("24", { timeout: 15_000 });

        const staleWriteResult = await peerPage.evaluate(async ({ snapshot, id }) => {
          const payload = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
          const staleProgress = payload.packagingProgress?.[id];
          const staleValues = payload.runValues?.[id];
          if (!staleProgress || !staleValues) throw new Error("stale packaging snapshot missing");
          staleProgress.skidsCompleted = 0;
          staleProgress.casesOnCurrentSkid = 36;
          staleProgress.updatedAt += 30_000;
          staleValues.skidsCompleted = 0;
          staleValues.casesOnCurrentSkid = 36;
          payload.runValuesUpdatedAt ??= {};
          payload.runValuesUpdatedAt[id] = staleProgress.updatedAt;

          const epochResponse = await fetch("/api/sync/reset-epoch");
          const { epoch } = await epochResponse.json() as { epoch: number };
          const today = new Date().toISOString().slice(0, 10);
          const response = await fetch(
            `/api/sync/today?today=${today}&epoch=${epoch}`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                senderId: `stale-auto-${id}`,
                payload,
              }),
            },
          );
          return {
            status: response.status,
            body: await response.json() as {
              data?: {
                runValues?: Record<string, {
                  skidsCompleted?: number;
                  casesOnCurrentSkid?: number;
                }>;
              };
            },
          };
        }, { snapshot: staleSnapshot, id: runId! });

        expect(staleWriteResult.status).toBe(200);
        expect(staleWriteResult.body.data?.runValues?.[runId!]).toMatchObject({
          skidsCompleted: 0,
          casesOnCurrentSkid: 24,
        });
        await expect(primaryCases).toHaveText("24");
        await expect(peerCases).toHaveText("24");

        const serverPair = await page.evaluate(async ({ id }) => {
          const today = new Date().toISOString().slice(0, 10);
          const response = await fetch(`/api/sync/today?today=${today}`);
          const body = await response.json() as {
            runValues?: Record<string, {
              skidsCompleted?: number;
              casesOnCurrentSkid?: number;
            }>;
          };
          return body.runValues?.[id];
        }, { id: runId! });
        expect(serverPair).toMatchObject({
          skidsCompleted: 0,
          casesOnCurrentSkid: 24,
        });

        // Walk the production clock through the shared one-minute hold. Each
        // due tick updates the baseline while suppressed, so expiry permits one
        // normal +1 rather than replaying the whole hold interval.
        for (let offset = 6_000; offset <= 54_000; offset += 6_000) {
          await mockDateNow(page, baselineAt + offset);
          await simulateWake(page);
          await page.waitForTimeout(80);
          await expect(primaryCases).toHaveText("24");
        }
        await expect(peerCases).toHaveText("24");

        await mockDateNow(page, baselineAt + 60_001);
        await simulateWake(page);
        await expect(primaryCases).toHaveText("25", { timeout: 8_000 });
        await expect(peerCases).toHaveText("25", { timeout: 15_000 });
        // The aggregate tile lives on the Run tab; both pages are still on
        // Packaging after checking the pair above.
        await page.locator('[data-testid="tab-run"]').click();
        await peerPage.locator('[data-testid="tab-run"]').click();
        expect(await readCaseTotal(page)).toBe(25);
        expect(await readCaseTotal(peerPage)).toBe(25);
      } finally {
        await peer.close();
      }
    },
  );
});
