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

// ── config ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2esow${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

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
 *   casesPerSkid=10, freezerTime=5
 *
 * Derived constants:
 *   ppm = 30 × 2 = 60 pizza/min → casePeriod = 6 pizzas / 60 ppm = 6 s/case
 *   At t=15 min: afterTunnel=10 → expectedRaw = floor(600/6) = 100 cases
 *   At t=20 min: afterTunnel=15 → expectedRaw = floor(900/6) = 150 cases
 *
 * After setting values, DOM assertions confirm all six inputs hold the
 * expected numbers before returning.
 */
async function fillFormValues(page: Page): Promise<void> {
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
  const results: Record<string, boolean> = await page.evaluate(() => {
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
      ["input-casesPerSkid", "10"],
      ["input-freezerTime", "5"],
    ];
    for (const [testId, value] of fields) {
      const el = document.querySelector<HTMLInputElement>(
        `[data-testid="${testId}"]`,
      );
      hit[testId] = fireChange(el ?? null, value);
    }

    return hit;
  });

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
    };
  });

  expect(domValues.casesNeeded, "casesNeeded not set in DOM").toBe("200");
  expect(domValues.cycleSpeed, "cycleSpeed not set in DOM").toBe("30");
  expect(domValues.crustsPerCycle, "crustsPerCycle not set in DOM").toBe("2");
  expect(domValues.pizzasPerCase, "pizzasPerCase not set in DOM").toBe("6");
  expect(domValues.casesPerSkid, "casesPerSkid not set in DOM").toBe("10");
  expect(domValues.freezerTime, "freezerTime not set in DOM").toBe("5");
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
async function setupAndStartRun(page: Page): Promise<number> {
  await signUpAndDismissDialog(page, uid(), "TestPass123!");

  await page.locator('[data-testid="tab-run"]').click();
  await fillFormValues(page);

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
   * Safety guard: only proceeds when DATABASE_URL is a local address OR when
   * E2E_TEST_DB=1 is explicitly set.  This prevents accidental wipes of a
   * shared operational factory database.  These tests must be run against a
   * dedicated test database (the same requirement that global-setup.ts has).
   */
  test.beforeEach(async () => {
    const url = process.env.DATABASE_URL ?? "";
    // A "safe" test database is one of:
    //   • localhost / 127.0.0.1 — local dev Postgres
    //   • REPLIT_DEV_DOMAIN set — we are inside a Replit workspace (dev env)
    //   • E2E_TEST_DB=1 — explicit opt-in from CI
    // Production deployments have REPLIT_DEPLOYMENT set but not REPLIT_DEV_DOMAIN.
    const isTestDb =
      url.includes("localhost") ||
      url.includes("127.0.0.1") ||
      !!process.env.REPLIT_DEV_DOMAIN ||
      process.env.E2E_TEST_DB === "1";
    if (!isTestDb) {
      throw new Error(
        "screen-off-wake tests require a local DATABASE_URL, REPLIT_DEV_DOMAIN " +
          "set, or E2E_TEST_DB=1 to safely delete today's factory-wide " +
          "daily_sync row between tests.",
      );
    }
    const client = new PgClient({ connectionString: url });
    await client.connect();
    const today = new Date().toISOString().slice(0, 10);
    await client.query("DELETE FROM daily_sync WHERE date = $1", [today]);
    await client.end();
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
    "C. sleeping peer adopts lifecycle, profile changes, deletions, and factory settings on wake",
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

      await setupAndStartRun(page);
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
        await sleepingPage.evaluate((key) => {
          localStorage.setItem(
            `run-calc-profile-${key}`,
            JSON.stringify({ frontlineRecipeName: "Wake Sauce V1", app1Type: "Cheese" }),
          );
        }, profileKey);
        await installHiddenMock(sleepingPage);
        await simulateScreenOff(sleepingPage);

        // Changes happen while the peer is hidden: the live-row transition is
        // delivered by the normal sync path, while profiles/factory settings
        // have no server event stream and must be refreshed on foreground.
        await page.getByRole("button", { name: /pause.?run/i }).first().click();
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

        await simulateWake(sleepingPage);
        await sleepingPage.getByRole("button", { name: /resume.?run/i }).first()
          .waitFor({ state: "visible", timeout: 15_000 });
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

        // A second wake observes deletion rather than re-uploading the older
        // blob that was cached before screen-off.
        await simulateScreenOff(sleepingPage);
        const deleted = await page.evaluate(async (key) => {
          const res = await fetch("/api/brand-profiles", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ keys: [key] }),
          });
          return res.ok;
        }, profileKey);
        expect(deleted).toBe(true);
        await simulateWake(sleepingPage);
        await sleepingPage.waitForFunction(async ({ key }) => {
          const response = await fetch("/api/brand-profiles");
          const body = await response.json() as { items?: Array<{ key: string }> };
          return !body.items?.some((item) => item.key === key);
        }, { key: profileKey }, { timeout: 15_000 });
      } finally {
        await peer.close();
      }
    },
  );
});
