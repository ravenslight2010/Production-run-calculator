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
 *   cycleSpeed=30, crustsPerCycle=2, speedAdjustment=1  → ppm=60 pizza/min
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

import {
  test,
  expect,
  type Browser,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import {
  computeCasesInFreezer,
  computeCasesOnLine,
} from "@workspace/inventory-math";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  freshMasterDataSeedHeaders,
  type E2ECapability,
} from "./isolation";

// ── config ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2esow${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
let authorizedFixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
});

test.afterAll(async () => {
  await authorizedFixtures?.cleanup({
    syncDates: [new Date().toISOString().slice(0, 10)],
  });
});

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
 *   casesNeeded=200, cycleSpeed=30, crustsPerCycle=2, speedAdjustment=1,
 *   pizzasPerCase=6,
 *   casesPerSkid=10, freezerTime=5, doughballsPerTray=2,
 *   doughBatchYield=4
 *
 * Derived constants:
 *   ppm = 30 × 2 × 1 = 60 pizza/min → casePeriod = 6 pizzas / 60 ppm = 6 s/case
 *   At t=15 min: afterTunnel=10 → expectedRaw = floor(600/6) = 100 cases
 *   At t=20 min: afterTunnel=15 → expectedRaw = floor(900/6) = 150 cases
 *
 * After setting values, DOM assertions confirm all nine inputs hold the
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
  const isOpen = await lineSetupDetails
    .first()
    .evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) {
    await lineSetupDetails.locator("summary").first().click();
    await page.waitForTimeout(200); // CSS transition
  }

  // Step 3 — set values via native setter + bubbling events
  // (React Testing Library's proven pattern for controlled inputs)
  const results: Record<string, boolean> = await page.evaluate(
    (requestedCasesPerSkid) => {
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
        // Keep this fixture independent of the factory baseline. Its expected
        // cadence is 30 × 2 × 1 = 60 pizzas per minute.
        ["input-speedAdjustment", "1"],
        ["input-pizzasPerCase", "6"],
        ["input-casesPerSkid", requestedCasesPerSkid],
        // Keep the live form's extra case buffer aligned with the seeded
        // run-values snapshot used by the output-card assertion below.
        ["input-casesPerLayer", "1"],
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
    },
    casesPerSkid,
  );

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
      speedAdjustment: val("input-speedAdjustment"),
      pizzasPerCase: val("input-pizzasPerCase"),
      casesPerSkid: val("input-casesPerSkid"),
      casesPerLayer: val("input-casesPerLayer"),
      freezerTime: val("input-freezerTime"),
      doughballsPerTray: val("input-doughballsPerTray"),
      doughBatchYield: val("input-doughBatchYield"),
    };
  });

  expect(domValues.casesNeeded, "casesNeeded not set in DOM").toBe("200");
  expect(domValues.cycleSpeed, "cycleSpeed not set in DOM").toBe("30");
  expect(domValues.crustsPerCycle, "crustsPerCycle not set in DOM").toBe("2");
  expect(domValues.speedAdjustment, "speedAdjustment not set in DOM").toBe("1");
  expect(domValues.pizzasPerCase, "pizzasPerCase not set in DOM").toBe("6");
  expect(domValues.casesPerSkid, "casesPerSkid not set in DOM").toBe(
    casesPerSkid,
  );
  expect(domValues.casesPerLayer, "casesPerLayer not set in DOM").toBe("1");
  expect(domValues.freezerTime, "freezerTime not set in DOM").toBe("5");
  expect(domValues.doughballsPerTray, "doughballsPerTray not set in DOM").toBe(
    "2",
  );
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

async function currentForegroundSyncAck(page: Page): Promise<number> {
  const status = page.getByTestId("foreground-recovery-status");
  if (await status.count() === 0) return 0;
  const ack = Number(await status.getAttribute("data-foreground-sync-ack"));
  return Number.isFinite(ack) ? ack : 0;
}

async function recentForegroundRecoveryFailurePhases(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fixtureDate = (window as unknown as { __testFixtureDate?: unknown }).__testFixtureDate;
    if (typeof fixtureDate !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(`run-calc-sync-diagnostics:${fixtureDate}`) ?? "[]",
      );
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((event): event is { kind?: unknown; response?: unknown } =>
          !!event && typeof event === "object",
        )
        .filter((event) =>
          event.kind === "failure"
          && typeof event.response === "string"
          && event.response.startsWith("foreground-recovery:"),
        )
        .slice(-3)
        .map((event) => event.response as string);
    } catch {
      return [];
    }
  });
}

async function readSanitizedSyncDiagnosticCodes(
  page: Page,
): Promise<Array<{ kind: string; response: string }>> {
  return page.evaluate(() => {
    const fixtureDate = (window as unknown as { __testFixtureDate?: unknown }).__testFixtureDate;
    if (typeof fixtureDate !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(`run-calc-sync-diagnostics:${fixtureDate}`) ?? "[]",
      );
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((event): event is { kind?: unknown; response?: unknown } =>
          !!event && typeof event === "object",
        )
        .filter((event) =>
          typeof event.kind === "string"
          && typeof event.response === "string"
          && /^(?:peer-snapshot-rejected|partial-fallback|partial|unchanged|foreground-recovery:[a-z-]+|wake-recovery:[a-z-]+)$/.test(event.response),
        )
        .slice(-12)
        .map((event) => ({ kind: event.kind as string, response: event.response as string }));
    } catch {
      return [];
    }
  });
}

/** Wait for the online wake pull to be adopted before reading live counters. */
async function simulateOnlineWake(page: Page): Promise<void> {
  const ackBeforeWake = await currentForegroundSyncAck(page);
  const wakePull = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/sync/today",
    { timeout: 20_000 },
  );
  await simulateWake(page);
  const response = await wakePull;
  expect(
    response.ok(),
    `foreground wake pull failed with HTTP ${response.status()}`,
  ).toBe(true);
  const status = page.getByTestId("foreground-recovery-status");
  await expect(status).toBeVisible({ timeout: 10_000 });
  try {
    await expect(status).toHaveAttribute(
      "data-foreground-recovery-state",
      "outcome",
      { timeout: 20_000 },
    );
  } catch (error) {
    const phases = await recentForegroundRecoveryFailurePhases(page);
    const message = error instanceof Error ? error.message : "Foreground recovery did not complete";
    throw new Error(`${message}\nRecent foreground recovery phases: ${JSON.stringify(phases)}`);
  }
  await expect(status).toContainText("Latest production snapshot received.", {
    timeout: 20_000,
  });
  await expect.poll(async () => {
    const ack = Number(await status.getAttribute("data-foreground-sync-ack"));
    return Number.isFinite(ack) ? ack : 0;
  }, {
    timeout: 20_000,
    message: `online wake did not acknowledge canonical state; prior acknowledgement ${ackBeforeWake}`,
  }).toBeGreaterThan(ackBeforeWake);
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
 * The fixture date is captured once for live-sync reads/ticks, while the fake
 * clock starts at current wall time so server-stamped lifecycle actions remain
 * close to the test's start instant.
 *
 * The proxy is installed once per page (idempotent).  Subsequent calls just
 * update `__testFakeMs` — no proxy stacking.  Does NOT freeze timers.
 */
async function mockDateNow(
  page: Page,
  fakeMs: number,
  options: {
    tick?: boolean;
    skipAutoTrack?: boolean;
    rearm?: boolean;
  } = {},
): Promise<{
  fixtureDate?: string;
  projected?: boolean;
  canonicalRevision?: number;
  snapshotId?: string;
  autoTrackSchedule?: unknown;
  builtClaims?: number;
  accepted?: number;
  outcomes?: Record<string, number>;
  operationalProjection?: {
    runId?: string;
    counters?: {
      traysOnLine?: number;
      batchesReady?: number;
      casesOnLine?: number;
      casesCompleted?: number;
    };
    calc?: {
      batchesNeeded?: number;
      traysNeeded?: number;
      casesOnLine?: number;
    };
  } | null;
}> {
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
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    }) as unknown as typeof Date;
  }, fakeMs);
  if (options.tick === false) return {};
  // Lifecycle/correction writes are debounced for 600 ms. Let those canonical
  // writes land before the authoritative fixture beat reads and broadcasts the
  // server row, otherwise the beat can legitimately echo the previous state.
  await page.waitForTimeout(750);
  const fixtureDate = await page.evaluate(() => {
    const configured = (window as unknown as Record<string, unknown>).__testFixtureDate;
    return typeof configured === "string"
      ? configured
      : new Date().toISOString().slice(0, 10);
  });
  const response = await page.request.post(
    `/api/sync/e2e/auto-track-tick?today=${fixtureDate}`,
    {
      data: {
        nowMs: fakeMs + 1,
        ...(options.skipAutoTrack ? { skipAutoTrack: true } : {}),
        ...(options.rearm ? { rearm: true } : {}),
      },
    },
  );
  expect(
    response.ok(),
    `authoritative auto-track fixture tick failed: ${response.status()}`,
  ).toBe(true);
  // The endpoint response and its SSE projection travel on separate sockets.
  // Do not let a following operator action race the authoritative frame.
  await page.waitForTimeout(300);
  const body = await response.json();
  return { ...body, fixtureDate };
}

/** Advance the server-owned clock without replaying that interval on this client. */
async function tickServerWithoutAdvancingBrowserClock(
  page: Page,
  fakeMs: number,
): Promise<void> {
  await page.waitForTimeout(750);
  const fixtureDate = await page.evaluate(() => {
    const configured = (window as unknown as Record<string, unknown>).__testFixtureDate;
    return typeof configured === "string"
      ? configured
      : new Date().toISOString().slice(0, 10);
  });
  const response = await page.request.post(
    `/api/sync/e2e/auto-track-tick?today=${fixtureDate}`,
    { data: { nowMs: fakeMs + 1 } },
  );
  expect(
    response.ok(),
    `authoritative auto-track fixture tick failed: ${response.status()}`,
  ).toBe(true);
  await page.waitForTimeout(300);
}

async function followRealDateNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __origDate?: DateConstructor;
      __testFakeMs?: number;
      __testFollowRealTimer?: number;
    };
    if (!w.__origDate || w.__testFollowRealTimer) return;
    const originalDate = w.__origDate;
    w.__testFollowRealTimer = window.setInterval(() => {
      w.__testFakeMs = originalDate.now();
    }, 100);
  });
}

async function installDateProxyBeforeNavigation(
  page: Page,
  fakeMs: number,
  resetEpoch: number,
  fixtureDate: string,
): Promise<void> {
  await page.addInitScript(
    ({ fakeMs: initialFakeMs, resetEpoch: initialResetEpoch, fixtureDate: initialFixtureDate }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__testFixtureDate = initialFixtureDate;
      // A fresh browser context has no remembered reset epoch. Seed the
      // disposable fixture's current epoch before the app's boot check runs;
      // otherwise its intentional reset-and-reload races the wake setup.
      if (window.location.origin !== "null") {
        window.localStorage.setItem(
          "run-calc-reset-epoch",
          JSON.stringify(initialResetEpoch),
        );
      }
      let reloadMs = 0;
      try {
        reloadMs = Number(sessionStorage.getItem("__screenOffWakeReloadMs"));
      } catch {
        // Initial opaque frames may not have session storage yet.
      }
      w.__testFakeMs = Number.isFinite(reloadMs) && reloadMs > 0
        ? reloadMs : initialFakeMs;
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
    },
    { fakeMs, resetEpoch, fixtureDate },
  );
}

/**
 * Keep live sync data canonical while making its operational projection match
 * the deterministic fixture tick. Only the read-model projection is replaced.
 */
async function installOperationalProjectionOverride(
  page: Page,
): Promise<(projection: unknown) => Promise<void>> {
  let projection: unknown;
  const refreshOperationalProjectionClock = (
    candidate: unknown,
    serverTime: unknown,
  ): unknown => {
    if (
      !candidate
      || typeof candidate !== "object"
      || typeof serverTime !== "number"
      || !Number.isFinite(serverTime)
    ) {
      return candidate;
    }
    const value = candidate as Record<string, unknown>;
    const timestamps = [
      serverTime,
      value.serverTimeMs,
      value.capturedAtServerMs,
    ].filter(
      (timestamp): timestamp is number =>
        typeof timestamp === "number" && Number.isFinite(timestamp),
    );
    const monotonicTime = Math.max(...timestamps);
    return {
      ...value,
      serverTimeMs: monotonicTime,
      capturedAtServerMs: monotonicTime,
    };
  };
  await page.addInitScript(() => {
    const refreshOperationalProjectionClock = (
      candidate: unknown,
      serverTime: unknown,
    ): unknown => {
      if (
        !candidate
        || typeof candidate !== "object"
        || typeof serverTime !== "number"
        || !Number.isFinite(serverTime)
      ) {
        return candidate;
      }
      const value = candidate as Record<string, unknown>;
      const timestamps = [
        serverTime,
        value.serverTimeMs,
        value.capturedAtServerMs,
      ].filter(
        (timestamp): timestamp is number =>
          typeof timestamp === "number" && Number.isFinite(timestamp),
      );
      const monotonicTime = Math.max(...timestamps);
      return {
        ...value,
        serverTimeMs: monotonicTime,
        capturedAtServerMs: monotonicTime,
      };
    };
    const testWindow = window as unknown as { __testOperationalProjection?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(EventSource.prototype, "onmessage");
    if (!descriptor?.set) return;
    const originalSetter = descriptor.set;
    const originalGetter = descriptor.get;
    Object.defineProperty(EventSource.prototype, "onmessage", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: originalGetter
        ? function (this: EventSource) { return originalGetter.call(this); }
        : undefined,
      set: function (this: EventSource, handler: unknown) {
        if (typeof handler !== "function") {
          originalSetter.call(this, handler);
          return;
        }
        const source = this;
        const listener = handler as (event: MessageEvent) => void;
        originalSetter.call(this, (event: MessageEvent) => {
          const replacement = testWindow.__testOperationalProjection;
          if (replacement === undefined) {
            listener.call(source, event);
            return;
          }
          try {
            const frame = JSON.parse(event.data) as Record<string, unknown>;
            const frameData = frame.data && typeof frame.data === "object" && !Array.isArray(frame.data)
              ? frame.data as Record<string, unknown>
              : null;
            const hasTopLevelProjection = Object.prototype.hasOwnProperty.call(
              frame,
              "operationalProjection",
            );
            const hasNestedProjection = frameData !== null
              && Object.prototype.hasOwnProperty.call(frameData, "operationalProjection");
            if (!hasTopLevelProjection && !hasNestedProjection) {
              listener.call(source, event);
              return;
            }
            const frameServerTime = typeof frame.serverTime === "number"
              ? frame.serverTime
              : frameData?.serverTime;
            const refreshedProjection = refreshOperationalProjectionClock(replacement, frameServerTime);
            const refreshedFrame = { ...frame };
            if (hasTopLevelProjection) {
              refreshedFrame.operationalProjection = refreshedProjection;
            }
            if (hasNestedProjection && frameData) {
              refreshedFrame.data = {
                ...frameData,
                operationalProjection: refreshedProjection,
              };
            }
            listener.call(source, new MessageEvent(event.type, {
              data: JSON.stringify(refreshedFrame),
              origin: event.origin,
              lastEventId: event.lastEventId,
            }));
          } catch {
            listener.call(source, event);
          }
        });
      },
    });
  });
  await page.route("**/api/sync/today**", async (route) => {
    if (route.request().method() !== "GET" || projection === undefined) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.json() as Record<string, unknown>;
    const refreshedProjection = refreshOperationalProjectionClock(
      projection,
      body.serverTime,
    );
    await route.fulfill({
      response,
      json: { ...body, operationalProjection: refreshedProjection },
    });
  });
  return async (nextProjection) => {
    projection = nextProjection;
    await page.evaluate((value) => {
      (window as unknown as { __testOperationalProjection?: unknown })
        .__testOperationalProjection = value;
    }, nextProjection);
  };
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
    .filter({ visible: true })
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
      const val =
        parseInt((el.textContent ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
      return val !== prev;
    },
    { prev: prevTotal },
    { timeout: timeoutMs },
  );
}

/** Set the measured machine times used by the live dough countdowns. */
async function setMachineTimes(
  page: Page,
  values: Record<string, string> = {
    "input-mixerLowSec": "1",
    "input-mixerHighSec": "1",
    "input-hopperSec": "2",
  },
): Promise<void> {
  for (const [testId, value] of Object.entries(values)) {
    const input = page.getByTestId(testId).filter({ visible: true }).first();
    await input.fill(value);
    await input.blur();
    await expect(input, `${testId} should accept the requested timing`).toHaveValue(value);
  }
}

async function readDoughCounters(page: Page): Promise<{
  trays: number;
  batches: number;
}> {
  return page.evaluate(() => {
    const value = (name: string) =>
      Number(
        (
          document.querySelector(
            `input[name="${name}"]`,
          ) as HTMLInputElement | null
        )?.value ?? 0,
      );
    return {
      trays: value("traysOnLine"),
      batches: value("batchesReady"),
    };
  });
}

type LiveOperationalProjection = {
  runId?: string;
  serverTimeMs?: number;
  capturedAtServerMs?: number;
  counters?: {
    traysOnLine?: number;
    batchesReady?: number;
    casesCompleted?: number;
  };
  calc?: {
    casesOnLine?: number;
    batchesNeeded?: number;
    traysNeeded?: number;
  };
} | null;

async function readLiveRunSnapshot(page: Page): Promise<{
  runId: string;
  values: Record<string, number | string | boolean | null | undefined>;
  runValuesUpdatedAt: number | null;
  packagingProgress: {
    skidsCompleted: number;
    casesOnCurrentSkid: number;
    correctionGeneration: number;
    updatedAt: number;
    manualOverrideUntil: number;
  } | null;
  operationalProjection: LiveOperationalProjection;
  formDoughCounters: { trays: number; batches: number };
}> {
  return page.evaluate(async () => {
    const configured = (window as unknown as Record<string, unknown>).__testFixtureDate;
    const today = typeof configured === "string"
      ? configured
      : new Date().toISOString().slice(0, 10);
    const response = await fetch(`/api/sync/today?today=${today}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`live run payload request failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      dayState?: { currentRunId?: string; runs?: Array<{ id?: string }> };
      runValues?: Record<
        string,
        Record<string, number | string | boolean | null | undefined>
      >;
      runValuesUpdatedAt?: Record<string, number>;
      packagingProgress?: Record<string, {
        skidsCompleted: number;
        casesOnCurrentSkid: number;
        correctionGeneration: number;
        updatedAt: number;
        manualOverrideUntil: number;
      }>;
      operationalProjection?: LiveOperationalProjection;
      data?: { operationalProjection?: LiveOperationalProjection };
    };
    const runId =
      body.dayState?.currentRunId ??
      body.dayState?.runs?.find((run) => run.id)?.id;
    if (!runId || !body.runValues?.[runId]) {
      throw new Error("current run is missing from the live run payload");
    }
    return {
      runId,
      values: body.runValues[runId],
      runValuesUpdatedAt: body.runValuesUpdatedAt?.[runId] ?? null,
      packagingProgress: body.packagingProgress?.[runId] ?? null,
      operationalProjection:
        body.operationalProjection ?? body.data?.operationalProjection ?? null,
      formDoughCounters: {
        trays: Number(
          document.querySelector<HTMLInputElement>('input[name="traysOnLine"]')
            ?.value ?? 0,
        ),
        batches: Number(
          document.querySelector<HTMLInputElement>('input[name="batchesReady"]')
            ?.value ?? 0,
        ),
      },
    };
  });
}

async function liveProjectionMatchesCasesOnLine(page: Page): Promise<boolean> {
  try {
    const snapshot = await readLiveRunSnapshot(page);
    const projected = snapshot.operationalProjection?.calc?.casesOnLine;
    if (typeof projected !== "number" || !Number.isFinite(projected)) return false;
    return (await readCasesOnLine(page)) === projected;
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes("current run is missing from the live run payload")
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Let the form's 600 ms debounce enqueue before checking that sync has fully
 * acknowledged its writes. A fake-clock jump while an earlier write is
 * debounced can stamp that stale snapshot with the operator edit's timestamp.
 */
async function waitForSyncWritesToDrain(page: Page): Promise<void> {
  const syncHttpEvents: string[] = [];
  const syncWritePath = (request: Request): string | null => {
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    return pathname.startsWith("/api/sync/") && method !== "GET" && method !== "HEAD"
      ? `${method} ${pathname}`
      : null;
  };
  const recordSyncHttpEvent = (event: string) => {
    syncHttpEvents.push(event);
    if (syncHttpEvents.length > 20) syncHttpEvents.shift();
  };
  const onSyncRequest = (request: Request) => {
    const path = syncWritePath(request);
    if (path) recordSyncHttpEvent(`${path} started`);
  };
  const onSyncResponse = (response: Response) => {
    const path = syncWritePath(response.request());
    if (path) recordSyncHttpEvent(`${path} responded ${response.status()}`);
  };
  const onSyncRequestFailed = (request: Request) => {
    const path = syncWritePath(request);
    if (path) {
      recordSyncHttpEvent(
        `${path} failed ${request.failure()?.errorText ?? "unknown network error"}`,
      );
    }
  };
  page.on("request", onSyncRequest);
  page.on("response", onSyncResponse);
  page.on("requestfailed", onSyncRequestFailed);
  try {
    await page.waitForTimeout(750);
    const syncStatusButton = page.locator(
      'button[title="Sync connected"], button[title^="Sync:"]',
    ).first();
    await expect(syncStatusButton).toBeVisible({ timeout: 10_000 });

    const pendingWrites = page.getByText("Pending writes", { exact: true });
    const failedWrites = page.getByText("Failed writes", { exact: true });
    const alreadyOpen = await pendingWrites.isVisible().catch(() => false);
    if (!alreadyOpen) await syncStatusButton.click();

    await expect(pendingWrites).toBeVisible();
    await expect(failedWrites).toBeVisible();
    const readPendingCount = async () =>
      Number(await pendingWrites.evaluate(
        (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
      ));
    try {
      await expect.poll(readPendingCount, {
        timeout: 15_000,
        message: "pending sync writes did not drain",
      }).toBe(0);
    } catch (error) {
      const [pending, failed, activity] = await Promise.all([
        readPendingCount().catch(() => Number.NaN),
        failedWrites.evaluate(
          (element) => Number(element.nextElementSibling?.textContent?.trim() ?? "NaN"),
        ).catch(() => Number.NaN),
        page.locator('[data-testid^="sync-activity-"]').allTextContents()
          .then((entries) => entries.slice(0, 8).map((entry) =>
            entry.replace(/\s+· Run [A-Za-z0-9_-]+$/, ""),
          ))
          .catch(() => [] as string[]),
      ]);
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${cause}\nSync state at timeout: pending=${pending}, failed=${failed}; `
        + `recent activity: ${activity.join(" | ") || "none recorded"}; `
        + `recent sync HTTP: ${syncHttpEvents.slice(-12).join(" | ") || "none recorded"}`,
      );
    }
    await expect.poll(
      async () =>
        Number(await failedWrites.evaluate(
          (element) => element.nextElementSibling?.textContent?.trim() ?? "NaN",
        )),
      {
        timeout: 15_000,
        message: "sync writes failed instead of being acknowledged",
      },
    ).toBe(0);

    if (!alreadyOpen) await syncStatusButton.click();
  } finally {
    page.off("request", onSyncRequest);
    page.off("response", onSyncResponse);
    page.off("requestfailed", onSyncRequestFailed);
  }
}

async function readPersistedRunValues(
  page: Page,
  runId: string,
): Promise<Record<string, number | string | boolean | null | undefined>> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`run-calc-run-${id}`);
    if (!raw) throw new Error(`persisted run values missing for ${id}`);
    return JSON.parse(raw) as Record<
      string,
      number | string | boolean | null | undefined
    >;
  }, runId);
}

async function readLiveRunMeta(page: Page): Promise<{
  date?: string;
  startedAt?: number;
  pausedAt?: number;
  endedAt?: number;
  metaUpdatedAt?: number;
}> {
  return page.evaluate(async () => {
    const configured = (window as unknown as Record<string, unknown>).__testFixtureDate;
    const today = typeof configured === "string"
      ? configured
      : new Date().toISOString().slice(0, 10);
    const response = await fetch(`/api/sync/today?today=${today}`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`live run metadata request failed: ${response.status}`);
    const body = (await response.json()) as {
      dayState?: {
        date?: string;
        currentRunId?: string;
        currentIndex?: number;
        runs?: Array<{
          id?: string;
          startedAt?: number;
          pausedAt?: number;
          endedAt?: number;
          metaUpdatedAt?: number;
        }>;
      };
    };
    const run =
      body.dayState?.runs?.find(
        (candidate) => candidate.id === body.dayState?.currentRunId,
      ) ?? body.dayState?.runs?.[body.dayState?.currentIndex ?? 0];
    if (!run) throw new Error("current run metadata is missing");
    return { ...run, date: body.dayState?.date };
  });
}

async function chooseRunningTunnelIfPrompted(page: Page): Promise<void> {
  const choice = page
    .getByTestId("pause-stop-tunnel-no")
    .filter({ visible: true });
  await choice.waitFor({ state: "visible", timeout: 1_000 }).catch(() => {});
  if (await choice.isVisible().catch(() => false)) {
    await choice.click({ timeout: 1_000 }).catch(() => {});
  }
}

/** Set one visible dough counter through the same form events as an operator. */
async function writeDoughCounter(
  page: Page,
  name: "traysOnLine" | "batchesReady",
  value: number,
  settleMs = 350,
): Promise<void> {
  // Use the real controlled input rather than mutating DOM values behind
  // React Hook Form. Each correction must settle before the next section edit
  // so its baseline cannot be rebased from stale local state.
  const input = page.locator(`input[name="${name}"]`);
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.blur();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}

/** Set both visible dough counters through the operator form. */
async function writeDoughCounters(
  page: Page,
  counters: { trays: number; batches: number },
): Promise<void> {
  for (const [name, value] of [
    ["batchesReady", counters.batches],
    ["traysOnLine", counters.trays],
  ] as const) {
    await writeDoughCounter(page, name, value);
  }
}

async function waitForDoughCountersAcknowledged(
  page: Page,
  counters: { trays: number; batches: number },
): Promise<void> {
  await expect.poll(() => readDoughCounters(page), {
    timeout: 15_000,
    message: "dough inventory did not update in the form",
  }).toEqual(counters);
  await expect.poll(async () => {
    const { values } = await readLiveRunSnapshot(page);
    return {
      trays: Number(values.traysOnLine ?? 0),
      batches: Number(values.batchesReady ?? 0),
    };
  }, {
    timeout: 15_000,
    message: "dough inventory correction was not acknowledged by the server",
  }).toEqual(counters);
}

/** Seed dough inventory and wait for both UI and server acknowledgement. */
async function seedDoughCounters(
  page: Page,
  counters: { trays: number; batches: number },
  options: {
    pauseWhileSeeding?: boolean;
    resumeAtMs?: number;
    drainSyncBeforeResume?: boolean;
  } = {},
): Promise<void> {
  if (options.pauseWhileSeeding) {
    await page.locator('[data-testid="tab-run"]').click();
    const alreadyPaused = page.getByRole("button", { name: /resume.?run/i });
    if (await alreadyPaused.isVisible().catch(() => false)) {
      // setupAndStartRun can pause before its first authoritative tick; keep
      // that fence in place while the counters are seeded.
    } else {
      const pause = page.getByRole("button", { name: /pause.?run/i });
      await expect(pause).toBeVisible();
      await pause.click();
      await chooseRunningTunnelIfPrompted(page);
      await expect(alreadyPaused).toBeVisible();
      await expect
        .poll(async () => (await readLiveRunMeta(page)).pausedAt ?? 0)
        .toBeGreaterThan(0);
    }
    await page.locator('[data-testid="tab-dough"]').click();
  }
  await writeDoughCounters(page, counters);
  await waitForDoughCountersAcknowledged(page, counters);
  if (options.pauseWhileSeeding) {
    await page.locator('[data-testid="tab-run"]').click();
    const resume = page.getByRole("button", { name: /resume.?run/i });
    await expect(resume).toBeVisible();
    // Lifecycle actions are deliberately deferred while an ordinary sync
    // write is unacknowledged. The speed-adjustment case opts into checking
    // that boundary here, before Resume (not as a post-wake prerequisite).
    if (options.drainSyncBeforeResume) {
      await waitForSyncWritesToDrain(page);
    } else {
      await page.waitForTimeout(1_000);
    }
    const canonicalMeta = await readLiveRunMeta(page);
    const resumeAtMs = Math.max(
      options.resumeAtMs ?? 0,
      (canonicalMeta.pausedAt ?? 0) + 1,
      (canonicalMeta.metaUpdatedAt ?? 0) + 1,
    );
    if (options.resumeAtMs !== undefined) {
      await mockDateNow(page, resumeAtMs, { tick: false });
    }
    await resume.click();
    await expect
      .poll(async () => (await readLiveRunMeta(page)).pausedAt ?? 0, {
        timeout: 15_000,
      })
      .toBe(0);
    await expect(
      page.getByRole("button", { name: /pause.?run/i }),
    ).toBeVisible({ timeout: 15_000 });
  }
}

async function resumeDoughTrackingIfVisible(page: Page): Promise<void> {
  const resumeNow = page.getByTestId("btn-resume-now");
  // This action is only present while a manual override has an actionable
  // suggestion. Tests that reseed the same values must not wait for a banner
  // the app correctly does not render.
  if (await resumeNow.isVisible()) await resumeNow.click();
}

// ── shared setup ──────────────────────────────────────────────────────────────

/**
 * Full setup for one test:
 *   1. Create an isolated authorized account and open the app with its cookie.
 *   2. Navigate to the Run tab.
 *   3. Fill form values (cycleSpeed=30, crustsPerCycle=2, speedAdjustment=1,
 *      pizzasPerCase=6,
 *      casesPerSkid=10, freezerTime=5, casesNeeded=200).
 *   4. Install the Date proxy and hidden mock BEFORE clicking Start Run,
 *      anchored to current wall time. Sync requests and fixture ticks stay
 *      bound to the captured disposable row, without rewinding server time.
 *   5. Click START RUN and re-anchor the browser clock to the accepted
 *      canonical server timestamp.
 *   6. Wait for tile-cases-completed (confirms casesNeeded > 0 and run live).
 * Returns the accepted canonical startedAt used by deterministic fixture ticks.
 */
async function setupAndStartRun(
  page: Page,
  casesPerSkid = "10",
  capabilities: readonly E2ECapability[] = [],
  optionsOrPauseBeforeReturn: {
    initialDoughCounters?: { trays: number; batches: number };
    verifyInitialDoughCounters?: boolean;
    pauseBeforeReturn?: boolean;
  } | boolean = {},
): Promise<number> {
  const options: {
    initialDoughCounters?: { trays: number; batches: number };
    verifyInitialDoughCounters?: boolean;
    pauseBeforeReturn?: boolean;
  } =
    typeof optionsOrPauseBeforeReturn === "boolean"
      ? {}
      : optionsOrPauseBeforeReturn;
  const pauseBeforeReturn =
    typeof optionsOrPauseBeforeReturn === "boolean"
      ? optionsOrPauseBeforeReturn
      : optionsOrPauseBeforeReturn.pauseBeforeReturn ?? false;
  const username = uid();
  const account = await authorizedFixtures.createAccount({
    username,
    password: "TestPass123!",
    capabilities,
  });
  const seedDate = new Date().toISOString().slice(0, 10);
  await authorizedFixtures.seedTodaySync({
    token: account.token,
    senderId: `fixture:${username}`,
    date: seedDate,
    payload: {
      dayState: { date: seedDate, runs: [], currentIndex: 0 },
      runValues: {},
      runValuesUpdatedAt: {},
      syncVersion: 1,
      completeness: "complete",
    },
  });
  const resetEpochResponse = await page.request.get(
    `${API_BASE}/api/sync/reset-epoch`,
    { headers: { Cookie: `rc_auth=${account.token}` } },
  );
  if (!resetEpochResponse.ok()) {
    throw new Error(
      `Fixture reset epoch lookup failed with HTTP ${resetEpochResponse.status()}`,
    );
  }
  const resetEpochBody = await resetEpochResponse.json() as { epoch?: unknown };
  if (
    typeof resetEpochBody.epoch !== "number" ||
    !Number.isSafeInteger(resetEpochBody.epoch) ||
    resetEpochBody.epoch < 0
  ) {
    throw new Error("Fixture reset epoch lookup returned an invalid epoch");
  }
  // Install the controlled clock before the first application script runs.
  // The daily-reset watcher can otherwise reload the page while the fixture
  // is still filling the setup form when the real wall clock is near a
  // boundary.
  const safeBaseMs = Date.now();
  await installDateProxyBeforeNavigation(page, safeBaseMs, resetEpochBody.epoch, seedDate);
  await page.route("**/api/sync/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("today") !== seedDate) {
      url.searchParams.set("today", seedDate);
      await route.fallback({ url: url.toString() });
      return;
    }
    url.searchParams.set("today", seedDate);
    await route.fallback({ url: url.toString() });
  });
  await page.context().addCookies([
    {
      name: "rc_auth",
      value: account.token,
      url: API_BASE,
    },
  ]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByTestId("tab-run")
    .waitFor({ state: "attached", timeout: 25_000 });

  // Foreground recovery is intentionally event-driven rather than a startup
  // job. Require its canonical acknowledgement before mutating setup values.
  const initialRecoveryPull = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/sync/today",
    { timeout: 20_000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const initialRecoveryResponse = await initialRecoveryPull;
  expect(
    initialRecoveryResponse.ok(),
    `initial foreground recovery failed with HTTP ${initialRecoveryResponse.status()}`,
  ).toBe(true);
  const initialRecovery = page.getByTestId("foreground-recovery-status");
  await expect(initialRecovery).toHaveAttribute(
    "data-foreground-recovery-state",
    "outcome",
    { timeout: 20_000 },
  );
  await expect(initialRecovery).toContainText("Latest production snapshot received.", {
    timeout: 20_000,
  });
  await expect.poll(() => currentForegroundSyncAck(page), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await page.locator('[data-testid="tab-run"]').click();
  await fillFormValues(page, casesPerSkid);

  // Install the hidden-doc mock and date proxy BEFORE Start Run so the app
  // begins from the runner's current wall time.
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
  await page
    .locator('[data-testid="button-start-run"]')
    .waitFor({ state: "visible", timeout: 20_000 });

  await page.locator('[data-testid="button-start-run"]').click();

  // Both PAUSE RUN and STOP RUN appear; .first() avoids strict-mode error
  await page
    .getByRole("button", { name: /stop.?run|pause.?run/i })
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  if (pauseBeforeReturn) {
    const pause = page.getByRole("button", { name: /pause.?run/i });
    await pause.click();
    await chooseRunningTunnelIfPrompted(page);
    await expect(
      page.getByRole("button", { name: /resume.?run/i }),
    ).toBeVisible();
    await expect
      .poll(async () => (await readLiveRunMeta(page)).pausedAt ?? 0)
      .toBeGreaterThan(0);
  }

  // tile-cases-completed renders when casesNeeded > 0 (we set it to 200).
  // With mock time = safeBaseMs = startedAt, elapsedMin = 0, afterTunnel = 0,
  // expectedCases = 0 — the tile shows "0 / 200".
  await page
    .locator('[data-testid="tile-cases-completed"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  let canonicalStartedAt = 0;
  await expect
    .poll(async () => {
      canonicalStartedAt = Number((await readLiveRunMeta(page)).startedAt ?? 0);
      return canonicalStartedAt > 0;
    })
    .toBe(true);
  // Start is a server-owned lifecycle command, so its canonical timestamp can
  // differ slightly from the browser fixture instant. Re-anchor the display
  // clock to the accepted timestamp before arming cadence.
  await page.evaluate((ms) => {
    (window as unknown as Record<string, unknown>).__testFakeMs = ms;
  }, canonicalStartedAt);
  if (options.initialDoughCounters) {
    // Seed nonzero dough before the first authoritative auto-track beat.
    // Otherwise that beat may stage the full expected run supply while the
    // form still contains its zero defaults.
    await page.locator('[data-testid="tab-dough"]').click();
    await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
    await seedDoughCounters(page, options.initialDoughCounters);
    await page.locator('[data-testid="tab-run"]').click();
  }
  // Arm the server-owned wall-clock channels at the exact run start. Later
  // mocked wake times invoke the same authoritative tick path and SSE update
  // used in production instead of relying on retired browser-side mutations.
  const fixtureDate = new Date(canonicalStartedAt).toISOString().slice(0, 10);
  const tick = await page.request.post(`/api/sync/e2e/auto-track-tick?today=${fixtureDate}`, {
    data: { nowMs: canonicalStartedAt, rearm: true },
  });
  expect(tick.ok(), `initial authoritative auto-track fixture tick failed: ${tick.status()}`).toBe(true);
  await expect.poll(async () => {
    const { values } = await readLiveRunSnapshot(page);
    return {
      speedAdjustment: Number(values.speedAdjustment),
      cycleSpeed: Number(values.cycleSpeed),
      crustsPerCycle: Number(values.crustsPerCycle),
      pizzasPerCase: Number(values.pizzasPerCase),
      casesPerSkid: Number(values.casesPerSkid),
      freezerTime: Number(values.freezerTime),
    };
  }, {
    timeout: 15_000,
    message: "canonical run values do not match the screen-off fixture",
  }).toEqual({
    speedAdjustment: 1,
    cycleSpeed: 30,
    crustsPerCycle: 2,
    pizzasPerCase: 6,
    casesPerSkid: Number(casesPerSkid),
    freezerTime: 5,
  });
  if (options.initialDoughCounters && options.verifyInitialDoughCounters !== false) {
    await expect.poll(async () => {
      const { values } = await readLiveRunSnapshot(page);
      return {
        trays: Number(values.traysOnLine ?? 0),
        batches: Number(values.batchesReady ?? 0),
      };
    }, {
      timeout: 15_000,
      message: "initial dough counters changed during the authoritative start tick",
    }).toEqual(options.initialDoughCounters);
  }

  return canonicalStartedAt;
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
    await authorizedFixtures.removeTodaySync([
      new Date().toISOString().slice(0, 10),
    ]);
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
  //  setupAndStartRun() returns the accepted canonical start timestamp. The
  //  disposable sync reads and fixture ticks remain pinned to the captured row.
  //  Mock offsets are relative to that accepted timestamp.
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
  test("A. running run: counter jumps by full 50-case delta in one wake tick (no cap)", async ({
    page,
  }) => {
    const safeBaseMs = await setupAndStartRun(page);
    // Note: installHiddenMock + mockDateNow(safeBaseMs) already done in setup.

    // ── First wake: seed the authoritative boundary total ───────────────
    // This instant is exactly on a cadence edge. Depending on whether the
    // normal server loop or this deterministic fixture armed the run first,
    // the edge itself is either due now or one server millisecond later.
    await simulateScreenOff(page);
    await mockDateNow(page, safeBaseMs + 15 * 60_000);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, 0, 8_000);
    // Do NOT restoreDate here — see comment above.

    const casesBaseline = await readCaseTotal(page);
    expect(
      [99, 100],
      `baseline after +15 min must be the authoritative boundary value; got ${casesBaseline}`,
    ).toContain(casesBaseline);

    // ── Second wake: EXACTLY 50 more cases in ONE tick ──────────────────
    // The next five minutes add exactly 50 cases in one server beat.
    await simulateScreenOff(page);
    await mockDateNow(page, safeBaseMs + 20 * 60_000);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, casesBaseline, 8_000);

    const casesAfterWake = await readCaseTotal(page);
    const delta = casesAfterWake - casesBaseline;

    expect(
      casesAfterWake,
      `total after +20 min must preserve the baseline and add 50; got ${casesAfterWake}`,
    ).toBe(casesBaseline + 50);
    expect(
      delta,
      `delta must be exactly 50 (old 2-case cap would give 2); ` +
        `got Δ=${delta} (${casesBaseline}→${casesAfterWake})`,
    ).toBe(50);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. Paused run: the case counter stays frozen on wake.
  //
  //  useAutoTrack.ts: the case-tick effect guards on
  //  `(runStatus === "running" || drainActive)` — paused satisfies neither,
  //  so the effect exits before writing to skidsCompleted/casesOnCurrentSkid.
  //
  //  Same midnight-safety approach as Test A (no mid-test restoreDate).
  // ──────────────────────────────────────────────────────────────────────────
  test("B. paused run: counter stays frozen after screen-off + wake", async ({
    page,
  }) => {
    const safeBaseMs = await setupAndStartRun(page);

    // ── Baseline: running, +15 min → authoritative cadence boundary ─────
    await simulateScreenOff(page);
    await mockDateNow(page, safeBaseMs + 15 * 60_000);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, 0, 8_000);

    const casesBeforePause = await readCaseTotal(page);
    // elapsed = 15 min exactly → afterTunnel = 10 min → floor(10×60/6) = 100
    expect(
      [99, 100],
      `baseline before pause must be the authoritative boundary value; got ${casesBeforePause}`,
    ).toContain(casesBeforePause);

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
    await simulateOnlineWake(page);
    // Give React 2 s to settle — counter must NOT change.
    await page.waitForTimeout(2_000);

    const casesAfterPausedWake = await readCaseTotal(page);
    expect(
      casesAfterPausedWake,
      `paused wake: expected ${casesBeforePause}, got ${casesAfterPausedWake}`,
    ).toBe(casesBeforePause);
  });

  test("wake recovery queues one Stop tap and applies it to the same run", async ({
    page,
  }) => {
    const safeBaseMs = await setupAndStartRun(page);
    let heldWakePulls = 0;
    let releaseWakePull!: () => void;
    const wakePullReleased = new Promise<void>((resolve) => {
      releaseWakePull = resolve;
    });

    await page.route("**/api/sync/today**", async (route) => {
      if (route.request().method() === "GET" && heldWakePulls === 0) {
        heldWakePulls += 1;
        await wakePullReleased;
      }
      await route.continue();
    });

    await simulateScreenOff(page);
    await mockDateNow(page, safeBaseMs + 30_000);
    await simulateWake(page);
    await expect.poll(() => heldWakePulls, { timeout: 8_000 }).toBe(1);

    const stopButton = page.getByRole("button", { name: /^stop.?run$/i }).first();
    await stopButton.click();
    await expect(page.getByTestId("foreground-recovery-status"))
      .toContainText("Stop requested");
    await expect(page.getByRole("button", { name: /stop.?requested/i }))
      .toBeDisabled();
    releaseWakePull();
    await expect(page.getByText("Ended", { exact: true }).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("foreground-recovery-status"))
      .toContainText("Stop applied after recovery");
  });

  test(
    "responsive display matches shared line occupancy while running, paused, and draining",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const safeBaseMs = await setupAndStartRun(page);
      const lineHistoryStartOffsetMs = 10 * 60_000;
      const fixtureDate = new Date(safeBaseMs).toISOString().slice(0, 10);
      const offsetStartResponse = await page.request.post(
        `/api/sync/e2e/auto-track-tick?today=${fixtureDate}`,
        {
          data: {
            nowMs: Date.now(),
            rearm: true,
            startOffsetMs: lineHistoryStartOffsetMs,
          },
        },
      );
      expect(
        offsetStartResponse.ok(),
        `could not seed bounded historical line occupancy: HTTP ${offsetStartResponse.status()}`,
      ).toBe(true);
      const adjustedStartedAt = safeBaseMs - lineHistoryStartOffsetMs;
      await expect.poll(async () => (await readLiveRunMeta(page)).startedAt)
        .toBe(adjustedStartedAt);
      await expect(page.getByTestId("foreground-recovery-status"))
        .toHaveAttribute("data-foreground-recovery-state", "outcome", { timeout: 20_000 });
      expect(
        await currentForegroundSyncAck(page),
        "setup foreground recovery must be acknowledged before testing another wake",
      ).toBeGreaterThan(0);
      const occupancy = { ppm: 60, pizzasPerCase: 6, freezerTimeMin: 5 };
      const expectedRunning = computeCasesOnLine({
        startedAt: adjustedStartedAt,
        now: safeBaseMs + 2 * 60_000,
        ...occupancy,
      });

      const runningProjection = await mockDateNow(page, safeBaseMs + 2 * 60_000);
      expect(
        runningProjection.operationalProjection?.counters?.casesOnLine,
        `running projection missing; projected=${runningProjection.projected}; `
        + `fixtureDate=${runningProjection.fixtureDate}; schedule=${JSON.stringify(runningProjection.autoTrackSchedule)}`,
      ).toBe(expectedRunning);
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 2 * 60_000 + 501, { tick: false });
      await simulateOnlineWake(page);
      await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
        timeout: 10_000,
        message: "running display did not match the fresh server-time line projection",
      }).toBe(true);

      const pauseButton = page.getByRole("button", { name: /pause.?run/i }).first();
      await page.locator('[data-testid="tab-run"]').click();
      await page.evaluate((ms) => {
        (window as unknown as Record<string, unknown>).__testFakeMs = ms;
      }, Date.now());
      await pauseButton.click();
      await chooseRunningTunnelIfPrompted(page);
      let canonicalPausedAt = 0;
      let canonicalPausedDate = "";
      await expect.poll(async () => {
        const canonicalPausedMeta = await readLiveRunMeta(page);
        canonicalPausedAt = Number(canonicalPausedMeta.pausedAt ?? 0);
        canonicalPausedDate = canonicalPausedMeta.date ?? "";
        return canonicalPausedAt > 0;
      }, { timeout: 15_000 }).toBe(true);

      const pausedProjection = await mockDateNow(page, safeBaseMs + 12 * 60_000);
      const expectedPaused = pausedProjection.operationalProjection?.counters?.casesOnLine;
      expect(
        expectedPaused,
        `paused projection missing; projected=${pausedProjection.projected}; `
        + `fixtureDate=${pausedProjection.fixtureDate}; canonicalDate=${canonicalPausedDate}; `
        + `revision=${pausedProjection.canonicalRevision}; snapshot=${pausedProjection.snapshotId}; `
        + `schedule=${JSON.stringify(pausedProjection.autoTrackSchedule)}`,
      ).toEqual(expect.any(Number));
      await simulateScreenOff(page);
      await simulateOnlineWake(page);
      await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
        timeout: 10_000,
        message: "paused display did not match the fresh server line projection",
      }).toBe(true);

    await page.evaluate((ms) => {
      (window as unknown as Record<string, unknown>).__testFakeMs = ms;
    }, canonicalPausedAt + 1_000);
    await page
      .locator(
        '[data-testid="resume-run"]:visible, [data-testid="floor-resume-run"]:visible',
      ).first().click();
      await expect(page.getByRole("button", { name: /pause.?run/i }).first()).toBeVisible();
      await expect.poll(async () => {
        const run = await readLiveRunMeta(page);
        return run.pausedAt == null;
      }, { timeout: 20_000 }).toBe(true);

      // The canonical lifecycle retains the physical start and records the
      // closed pause separately.
      const requestedEndAt = safeBaseMs + 15 * 60_000;
      await mockDateNow(page, requestedEndAt);
      await simulateScreenOff(page);
      await simulateOnlineWake(page);
      await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
        timeout: 10_000,
        message: "resumed display did not match the fresh server line projection",
      }).toBe(true);

      // Lifecycle commands are server-timestamped. Keep the optimistic browser
      // stamp no newer than End so the server remains authoritative.
      const stopAtMs = Date.now();
      await page.evaluate((ms) => {
        (window as unknown as Record<string, unknown>).__testFakeMs = ms;
      }, stopAtMs);
      await page.getByRole("button", { name: /stop.?run/i }).first().click();
      let endedAt = 0;
      await expect.poll(async () => {
        endedAt = Number((await readLiveRunMeta(page)).endedAt ?? 0);
        return endedAt > 0;
      }, { timeout: 15_000 }).toBe(true);

      await mockDateNow(page, endedAt + 5_000);
      await simulateScreenOff(page);
      // Move the browser wall clock back while hidden; foreground recovery
      // must adopt and display the canonical server-time draining projection.
      await page.evaluate((ms) => {
        (window as unknown as Record<string, unknown>).__testFakeMs = ms;
      }, stopAtMs);
      await simulateOnlineWake(page);
      await expect.poll(() => liveProjectionMatchesCasesOnLine(page), {
        timeout: 10_000,
        message: "draining display did not match the fresh server line projection",
      }).toBe(true);
      await expect.poll(async () => {
        const snapshot = await readLiveRunSnapshot(page);
        return snapshot.operationalProjection?.calc?.casesOnLine ?? 0;
      }).toBeGreaterThan(0);
    },
  );

  test(
    "preserves cases-on-line occupancy across reload while the freezer drains",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const safeBaseMs = await setupAndStartRun(page);
      const occupancy = {
        ppm: 60,
        pizzasPerCase: 6,
        freezerTimeMin: 5,
      };
      const requestedEndAt = safeBaseMs + 15 * 60_000;

      // End at a deterministic mocked instant so the persisted lifecycle
      // timestamp is stable across the reload.
      await mockDateNow(page, requestedEndAt);
      await simulateScreenOff(page);
      await simulateOnlineWake(page);
      await page.getByRole("button", { name: /stop.?run/i }).first().click();
      let endedAt = 0;
      await expect.poll(async () => {
        endedAt = Number((await readLiveRunMeta(page)).endedAt ?? 0);
        return endedAt > 0;
      }, { timeout: 15_000 }).toBe(true);
      const drainAt = endedAt + (occupancy.freezerTimeMin + 1.25) * 60_000;

      const drainingAt = endedAt + 3 * 60_000;
      const drainingProjection = await mockDateNow(page, drainingAt);
      const expectedDraining = drainingProjection.operationalProjection?.counters?.casesOnLine;

      // A station refresh recreates the page and its clock context. Reinstall
      // the test clock after reload, then wake the page so the UI renders at
      // the exact same instant as the shared calculation.
      await page.reload({ waitUntil: "domcontentloaded" });
      await installHiddenMock(page);
      await mockDateNow(page, drainingAt);
      await simulateOnlineWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedDraining);

      // The two-wide press-to-oven segment extends physical occupancy beyond
      // freezerTime alone; the shared model is empty at the full drain boundary.
      await simulateScreenOff(page);
      await mockDateNow(page, drainAt, { tick: false });
      await simulateWake(page);
      const drainTick = await page.request.post(
        `/api/sync/e2e/auto-track-tick?today=${new Date(safeBaseMs).toISOString().slice(0, 10)}`,
        { data: { nowMs: drainAt } },
      );
      expect(drainTick.ok(), `authoritative drain tick failed: ${drainTick.status()}`).toBe(true);
      // The fixture beat updates the canonical operational snapshot, while the
      // page's local lifecycle copy may still be the pre-beat ended snapshot.
      // Rehydrate once so the final UI assertion observes that acknowledged
      // lifecycle and its drain-time clock together.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      await installHiddenMock(page);
      await mockDateNow(page, drainAt, { tick: false });
      await simulateOnlineWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(
        computeCasesOnLine({
          startedAt: safeBaseMs,
          endedAt,
          now: drainAt,
          ...occupancy,
        }),
      );
      await expect.poll(() => readCasesOnLine(page)).toBe(0);
    },
  );

  test(
    "keeps cases-on-line occupancy frozen across reload while paused",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const setOperationalProjection = await installOperationalProjectionOverride(page);
      const safeBaseMs = await setupAndStartRun(page);
      const occupancy = {
        ppm: 60,
        pizzasPerCase: 6,
        freezerTimeMin: 5,
      };
      const requestedPauseAt = safeBaseMs + 2 * 60_000;
      const pausedCheckAt = safeBaseMs + 12 * 60_000;

      // Persist the pause at a deterministic instant before recreating the
      // station page.
      await mockDateNow(page, requestedPauseAt);
      await simulateScreenOff(page);
      await simulateOnlineWake(page);
      await page.evaluate((ms) => {
        (window as unknown as Record<string, unknown>).__testFakeMs = ms;
      }, requestedPauseAt + 1_000);
      await page.getByRole("button", { name: /pause.?run/i }).first().click();
      await chooseRunningTunnelIfPrompted(page);
      let canonicalPausedAt = 0;
      await expect.poll(async () => {
        canonicalPausedAt = Number((await readLiveRunMeta(page)).pausedAt ?? 0);
        return canonicalPausedAt > 0;
      }, { timeout: 15_000 }).toBe(true);

      // A reload must restore the persisted paused lifecycle, not treat the
      // elapsed wall time as newly-running time.
      await page.reload({ waitUntil: "domcontentloaded" });
      await installHiddenMock(page);
      const pausedProjection = await mockDateNow(page, pausedCheckAt);
      const expectedPaused = pausedProjection.operationalProjection?.counters?.casesOnLine;
      await setOperationalProjection(pausedProjection.operationalProjection);
      await simulateOnlineWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(expectedPaused);
      await expect(
        page.locator(
          '[data-testid="resume-run"]:visible, [data-testid="floor-resume-run"]:visible',
        )
        .first(),
    ).toBeVisible();

    // The selector remains frozen until the operator resumes the line.
    const resumedCheckAt = safeBaseMs + 15 * 60_000;
    await page.evaluate((ms) => {
      (window as unknown as Record<string, unknown>).__testFakeMs = ms;
    }, canonicalPausedAt + 1_000);
    await page
      .locator(
        '[data-testid="resume-run"]:visible, [data-testid="floor-resume-run"]:visible',
      ).first().click();
      await expect.poll(async () => {
        const run = await readLiveRunMeta(page);
        return run.pausedAt == null;
      }, { timeout: 20_000 }).toBe(true);
      const resumedProjection = await mockDateNow(page, resumedCheckAt);
      await setOperationalProjection(resumedProjection.operationalProjection);
      await simulateScreenOff(page);
      await simulateOnlineWake(page);
      await expect.poll(() => readCasesOnLine(page)).toBe(
        resumedProjection.operationalProjection?.counters?.casesOnLine,
      );
    },
  );

  test(
    "D. pause, background sleep, and resume keep all live countdowns aligned",
    async ({ page }) => {
      const safeBaseMs = await setupAndStartRun(
        page,
        "10",
        [],
        // The controlled 3/3 inventory below is the scenario baseline. Keep
        // startup paused instead of preloading stock that the startup tick can
        // legitimately adjust before this test establishes that baseline.
        { pauseBeforeReturn: true },
      );
      const initialCases = await readCaseTotal(page);
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      // Establish the target inventory while paused so the first running beat
      // cannot seed it. Keep the counters within the operator-facing 3-batch
      // limit.
      await setMachineTimes(page, {
        "input-mixerLowSec": "600",
        "input-mixerHighSec": "600",
        "input-hopperSec": "600",
      });
      await seedDoughCounters(page, { trays: 3, batches: 3 });
      await page.locator('[data-testid="tab-run"]').click();
      const setupResume = page.getByRole("button", { name: /resume.?run/i });
      await expect(setupResume).toBeVisible();
      await setupResume.click();
      await expect
        .poll(async () => (await readLiveRunMeta(page)).pausedAt ?? 0)
        .toBe(0);
      await expect(
        page.getByRole("button", { name: /pause.?run/i }),
      ).toBeVisible();
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page);
      // Deterministic populated fixture:
      //   2 doughballs/tray → tray cadence = 2 s at 60 ppm
      //   4 doughballs/batch and hopper=2 s → quarter-batch cadence = 1 s
      //   mixer=2 s → batch production cadence = 2 s
      // Change one counter and inspect the banner before another form edit or
      // server acknowledgment. Its one-tray-cadence suppression window is
      // intentionally short; those later waits can outlast the visible action.
      const beforeFirstCorrection = await readDoughCounters(page);
      const firstBatchTarget = beforeFirstCorrection.batches > 0
        ? beforeFirstCorrection.batches - 1
        : beforeFirstCorrection.batches + 1;
      await writeDoughCounter(page, "batchesReady", firstBatchTarget, 0);
      const firstAutoResume = page.getByRole("button", { name: /resume auto tracking/i });
      await expect(firstAutoResume).toBeVisible();
      await firstAutoResume.click();
      await page.waitForTimeout(400);
      const firstCorrection = {
        trays: beforeFirstCorrection.trays,
        batches: firstBatchTarget,
      };
      expect(await readDoughCounters(page), "first Auto Resume must not write immediately").toEqual(
        firstCorrection,
      );
      await waitForDoughCountersAcknowledged(page, firstCorrection);

      await writeDoughCounter(page, "traysOnLine", 3);
      await writeDoughCounter(page, "batchesReady", 3, 0);
      const finalAutoResume = page.getByRole("button", { name: /resume auto tracking/i });
      await expect(finalAutoResume).toBeVisible();
      const beforeAutoResume = await readDoughCounters(page);
      expect(beforeAutoResume).toEqual({ trays: 3, batches: 3 });
      // Counter edits follow the real operator path and temporarily suppress
      // auto tracking. Resume it before asserting the live countdowns or the
      // batch-production labels are correctly hidden by the UI.
      await finalAutoResume.click();
      // Resume must re-arm the dough clocks from their full configured
      // intervals. A 300ms window is safely below the shortest one-second
      // batch cadence; an immediate due-time reset would already have changed
      // the populated batch counter here.
      await page.waitForTimeout(300);
      expect(await readDoughCounters(page), "Auto Resume must not write immediately").toEqual(beforeAutoResume);
      await waitForDoughCountersAcknowledged(page, beforeAutoResume);

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
      await expect(page.getByText("Line uses ¼ batch in", { exact: true })).toBeVisible();

      const beforePause = {
        cases: initialCases,
        dough: await readDoughCounters(page),
      };
      expect(beforePause.dough).toEqual({ trays: 3, batches: 3 });

      await page.locator('[data-testid="tab-run"]').click();
      const pauseButton = page.getByRole("button", { name: /pause.?run/i }).first();
      await pauseButton.click();
      await chooseRunningTunnelIfPrompted(page);
      await expect.poll(async () => Number((await readLiveRunMeta(page)).pausedAt ?? 0) > 0, {
        timeout: 15_000,
      }).toBe(true);

      // A hidden tab can be throttled for much longer than a normal timer
      // period. Wake at +10 s, while paused: no channel may write, seed, or
      // consume during the paused interval.
      await simulateScreenOff(page);
      await mockDateNow(page, safeBaseMs + 10_000);
      await simulateWake(page);
      await page.waitForTimeout(800);
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });

    expect(await readDoughCounters(page), "paused dough counters").toEqual(
      beforePause.dough,
    );

    // Resume from the same mocked instant. The authoritative due refs must
    // re-arm from this instant; advancing one case period then permits one
    // case write, without replaying the hidden +10 s.
    await page.locator('[data-testid="tab-run"]').click();
    const resumeButton = page
      .locator(
        '[data-testid="resume-run"]:visible, [data-testid="floor-resume-run"]:visible',
      )
      .first();
    await resumeButton.click();
    await expect
      .poll(async () => (await readLiveRunMeta(page)).pausedAt == null, {
        timeout: 20_000,
      })
      .toBe(true);
    await page.locator('[data-testid="tab-dough"]').click();
    await page
      .getByText("Machine Times", { exact: true })
      .waitFor({ state: "visible" });

    // The first authoritative beat after Resume establishes the new
    // lifecycle generation and arms its dough schedule; it must not replay
    // the ten seconds spent paused.
    await simulateScreenOff(page);
    const firstResumeBeat = await mockDateNow(page, safeBaseMs + 11_100);
    await simulateWake(page);
    await page.waitForTimeout(500);
    expect(
      await readDoughCounters(page),
      "first resumed beat should only re-arm the authoritative schedule",
    ).toEqual({
      trays: firstResumeBeat.operationalProjection?.counters?.traysOnLine,
      batches: firstResumeBeat.operationalProjection?.counters?.batchesReady,
    });

    // At +2.1 s, one tray production and one tray consumption coincide
    // (net zero), while mixer production adds one batch and the quarter
    // drain removes another 0.25. This catches duplicate production and
    // phantom catch-up writes from the hidden interval.
    await simulateScreenOff(page);
    const secondResumeBeat = await mockDateNow(page, safeBaseMs + 12_100);
    await simulateWake(page);
    await page.waitForTimeout(500);
    expect(
      await readDoughCounters(page),
      "second resumed boundary should pair tray writes and add one mixer batch",
    ).toEqual({
      trays: secondResumeBeat.operationalProjection?.counters?.traysOnLine,
      batches: secondResumeBeat.operationalProjection?.counters?.batchesReady,
    });
    // Replaying the same visibility event at the same mocked instant must
    // not duplicate any of the writes just observed.
    await simulateWake(page);
    await page.waitForTimeout(300);
    expect(await readDoughCounters(page), "duplicate wake writes").toEqual({
      trays: secondResumeBeat.operationalProjection?.counters?.traysOnLine,
      batches: secondResumeBeat.operationalProjection?.counters?.batchesReady,
    });

    // The shared setup uses a five-minute freezer/tunnel window. Advance
    // beyond that window plus a six-second case period. The due phase can
    // allow a second case while this foreground observation settles, but a
    // replay of the ten paused seconds would produce more than two.
    await mockDateNow(page, safeBaseMs + 5 * 60_000 + 16_500);
    await simulateScreenOff(page);
    await simulateWake(page);
    await page.locator('[data-testid="tab-run"]').click();
    await waitForCaseCounterChange(page, beforePause.cases, 8_000);

    const resumedCases = await readCaseTotal(page);
    expect(
      resumedCases,
      "resume should produce a case from active time",
    ).toBeGreaterThanOrEqual(beforePause.cases + 1);
    expect(
      resumedCases,
      "resume must not replay the ten seconds spent paused",
    ).toBeLessThanOrEqual(beforePause.cases + 2);
    // Dough counters are no longer on the Run tab; the exact boundaries
    // above prove their writes before this final packaging assertion.
  });

  test(
    "speed adjustment during a dough run stays aligned across screen wake",
    async ({ page }, testInfo) => {
      test.slow();
      const safeBaseMs = await setupAndStartRun(
        page,
        "10",
        DEFAULT_MANAGER_CAPABILITIES,
        {
          initialDoughCounters: { trays: 10, batches: 2 },
          // This scenario reseeds and asserts its exact 10/2 baseline below;
          // the first zero-arm rearm beat may consume from this helper seed.
          verifyInitialDoughCounters: false,
          pauseBeforeReturn: true,
        },
      );

      // Use the real Dough controls to establish known stock before the
      // speed edit. Keep machine production from racing the controlled stock
      // correction, then resume only after the server acknowledges the values.
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page, {
        "input-mixerLowSec": "600",
        "input-mixerHighSec": "600",
        "input-hopperSec": "600",
      });
      await seedDoughCounters(page, { trays: 10, batches: 2 }, {
        pauseWhileSeeding: true,
      });
      await page.locator('[data-testid="tab-dough"]').click();
      await resumeDoughTrackingIfVisible(page);
      await page.locator('[data-testid="tab-run"]').click();

    const lineSetupDetails = page
      .locator("details")
      .filter({
        has: page.locator("summary", { hasText: /line.?setup/i }),
      })
      .first();
    if (
      !(await lineSetupDetails.evaluate(
        (element) => (element as HTMLDetailsElement).open,
      ))
    ) {
      await lineSetupDetails.locator("summary").click();
    }
    const speedInput = page
      .getByTestId("input-speedAdjustment")
      .filter({ visible: true })
      .first();
    await expect(speedInput).toBeVisible();
    expect(
      Number(await speedInput.inputValue()),
      "baseline speed adjustment",
    ).toBe(1);
    await expect
      .poll(
        async () => {
          const current = await readLiveRunSnapshot(page);
          return {
            speedAdjustment: current.values.speedAdjustment,
            traysOnLine: current.values.traysOnLine,
            batchesReady: current.values.batchesReady,
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        speedAdjustment: 1,
        traysOnLine: 10,
        batchesReady: 2,
      });

      await waitForSyncWritesToDrain(page);
      // This is the operator action under test: slow the line while it is
      // already running. A 12-second hidden interval is long enough to expose
      // stale due timestamps at the new 30 PPM speed, but remains inside the
      // five-minute freezer window so the case count stays at zero.
      const speedEditedAt = Math.max(safeBaseMs + 1_000, Date.now());
      // Establish the operator's edit instant without running an authoritative
      // auto-track beat first. The beat stamps the canonical run at
      // speedEditedAt + 1 ms, which would make the immediately-following
      // browser edit look stale to the server's LWW guard.
      await mockDateNow(page, speedEditedAt, { tick: false });
      await speedInput.fill("0.5");
      await speedInput.blur();
      await expect(speedInput).toHaveValue("0.5");
      await expect.poll(async () => {
        const snapshot = await readLiveRunSnapshot(page);
        return snapshot.values.speedAdjustment;
      }, { timeout: 15_000 }).toBe(0.5);
      await waitForSyncWritesToDrain(page);

      // Pause/resume writes must be newer than the speed edit under the
      // server's run-value LWW fence. Advance only the browser clock; do not
      // run an authoritative auto-track beat before reseeding.
      await mockDateNow(page, speedEditedAt + 1, { tick: false });
      const pause = page.getByRole("button", { name: /pause.?run/i });
      await expect(pause).toBeVisible();
      await pause.click();
      await chooseRunningTunnelIfPrompted(page);
      const resume = page.getByRole("button", { name: /resume.?run/i });
      await expect(resume).toBeVisible();
      await expect
        .poll(async () => (await readLiveRunMeta(page)).pausedAt ?? 0)
        .toBeGreaterThan(0);

      const canonicalPausedMeta = await readLiveRunMeta(page);
      await mockDateNow(
        page,
        Math.max(
          speedEditedAt + 1,
          (canonicalPausedMeta.pausedAt ?? 0) + 1,
          Date.now(),
        ),
        { tick: false },
      );

      // Keep this journey focused on line-speed cadence. Positive, long machine
      // times prevent a separate mixer completion during this short wake test.
      // Zero is a legacy sentinel that heals to standard defaults, not a
      // supported way to disable machine timing.
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page, {
        "input-mixerLowSec": "600",
        "input-mixerHighSec": "600",
        "input-hopperSec": "600",
      });
      await seedDoughCounters(page, { trays: 10, batches: 2 }, {
        pauseWhileSeeding: true,
        drainSyncBeforeResume: true,
      });
      await expect.poll(async () => {
        const { values } = await readLiveRunSnapshot(page);
        return {
          mixerLowSec: Number(values.mixerLowSec),
          mixerHighSec: Number(values.mixerHighSec),
          hopperSec: Number(values.hopperSec),
        };
      }, {
        timeout: 15_000,
        message: "positive machine timing edits were not acknowledged by the server",
      }).toEqual({ mixerLowSec: 600, mixerHighSec: 600, hopperSec: 600 });
      await resumeDoughTrackingIfVisible(page);
      await page.locator('[data-testid="tab-run"]').click();
      await waitForSyncWritesToDrain(page);

      await page.screenshot({
        path: testInfo.outputPath("speed-adjustment-before-wake.png"),
        fullPage: true,
      });

    await page.screenshot({
      path: testInfo.outputPath("speed-adjustment-before-wake.png"),
      fullPage: true,
    });

    const beforeWakeProjection =
      (await readLiveRunSnapshot(page)).operationalProjection;
    const wakeBaseMs = beforeWakeProjection?.serverTimeMs;
    expect(wakeBaseMs).toEqual(expect.any(Number));
    if (typeof wakeBaseMs !== "number") {
      throw new Error("server projection is missing its capture time before wake");
    }
    const wakeAt = wakeBaseMs + 12_000;

    let heldWakePulls = 0;
    let awaitingWakePull = false;
    let releaseWakePull!: () => void;
    const wakePullReleased = new Promise<void>((resolve) => {
      releaseWakePull = resolve;
    });
    await page.route("**/api/sync/today**", async (route) => {
      if (
        route.request().method() === "GET" &&
        awaitingWakePull &&
        heldWakePulls === 0
      ) {
        heldWakePulls += 1;
        await wakePullReleased;
      }
      await route.continue();
    });

    await simulateScreenOff(page);
    // Re-arm at the wake instant without processing hidden-time claims. The
    // next fixture beat is one visible interval after this baseline.
    const rearmBeat = await mockDateNow(page, wakeAt, { rearm: true });
    const rearmedSchedule = rearmBeat.autoTrackSchedule as {
      atMs?: number;
      entries?: Array<{
        channel?: string;
        dueAt?: number;
        dueNow?: boolean;
        nextDueAt?: number;
      }>;
    } | undefined;
    const nextBatchConsumption = rearmedSchedule?.entries?.find(
      (entry) => entry.channel === "batch-consume",
    );
    expect(
      nextBatchConsumption?.dueAt,
      `server schedule did not provide the edited-speed batch-consumption boundary: `
      + `${JSON.stringify({
        atMs: rearmedSchedule?.atMs,
        entries: rearmedSchedule?.entries?.map(({ channel, dueAt, dueNow }) => ({
          channel,
          dueAt,
          dueNow,
        })),
      })}`,
    ).toEqual(expect.any(Number));
    if (typeof nextBatchConsumption?.dueAt !== "number") {
      throw new Error("server schedule is missing the next batch-consumption boundary");
    }
    awaitingWakePull = true;
    await simulateWake(page);
    const recoveryStatus = page.getByTestId("foreground-recovery-status");
    await expect.poll(() => heldWakePulls, { timeout: 10_000 }).toBe(1);
    await expect(recoveryStatus).toContainText("Still recovering");
    await expect(recoveryStatus).toHaveAttribute(
      "data-foreground-recovery-state",
      "recovering",
    );
    releaseWakePull();
    await page.locator('[data-testid="tab-dough"]').click();
    await page
      .getByText("Machine Times", { exact: true })
      .waitFor({ state: "visible" });
    await expect(recoveryStatus).toContainText(
      "Latest production snapshot received.",
      { timeout: 10_000 },
    );
    await expect(recoveryStatus).toHaveAttribute(
      "data-foreground-recovery-state",
      "outcome",
    );
    await page.unroute("**/api/sync/today**");

    // Foreground reconciliation intentionally re-arms all live timers from
    // the wake instant. Hidden time must not be replayed with either the old
    // 60 PPM cadence or the new 30 PPM cadence. A fresh visible interval may
    // legitimately consume a fractional quarter-batch while the foreground
    // reconciliation is settling, so assert the bounded staged range rather
    // than assuming that no visible tick can land during recovery.
    // Read the form and canonical run values in one browser evaluation. A
    // server-owned visible beat may land between separate reads, so wait for
    // both views to agree instead of comparing a stale DOM sample to a later
    // server snapshot.
    let postWakeDough: { trays: number; batches: number } | null = null;
    let lastWakeProjectionCounters:
      | NonNullable<LiveOperationalProjection>["counters"]
      | null = null;
    try {
      await expect
        .poll(
          async () => {
            const current = await readLiveRunSnapshot(page);
            lastWakeProjectionCounters = current.operationalProjection?.counters ?? null;
            const trays = Number(current.values.traysOnLine);
            const batches = Number(current.values.batchesReady);
            const formCounters = current.formDoughCounters;
            const withinWakeBounds =
              trays >= 9 && trays <= 10 && batches > 0 && batches <= 2;
            const formMatchesCanonical =
              formCounters.trays === trays && formCounters.batches === batches;
            if (
              current.values.speedAdjustment === 0.5 &&
              withinWakeBounds &&
              formMatchesCanonical
            ) {
              postWakeDough = { trays, batches };
              return true;
            }
            return false;
          },
          {
            timeout: 10_000,
            message:
              "wake replayed hidden dough time or the form did not adopt canonical counters",
          },
        )
        .toBe(true);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${cause}\nLast server operational projection counters: `
        + `${JSON.stringify(lastWakeProjectionCounters)}`,
      );
    }
    if (!postWakeDough) {
      throw new Error("Wake counters did not converge to the canonical run snapshot");
    }
    // One visible production beat may consume a tray as recovery settles;
    // multiple hidden-time tray decrements are still forbidden.
    expect(postWakeDough.trays).toBeGreaterThanOrEqual(9);
    expect(postWakeDough.trays).toBeLessThanOrEqual(10);
    expect(postWakeDough.batches).toBeGreaterThan(0);
    expect(postWakeDough.batches).toBeLessThanOrEqual(2);

    // Advance to the server's next edited-speed batch-consumption boundary.
    // The fixture has shared recipe data, so a hard-coded tray/batch interval
    // would not necessarily be due after 4.1 seconds.
    const nextVisibleIntervalAt = Math.max(
      wakeAt + 1,
      nextBatchConsumption.dueAt + 1,
    );
    const cadenceBeat = await mockDateNow(page, nextVisibleIntervalAt);
    const cadenceEntries = (
      cadenceBeat.autoTrackSchedule as {
        entries?: Array<{
          channel?: string;
          dueNow?: boolean;
          dueAt?: number;
          nextDueAt?: number;
        }>;
      } | undefined
    )?.entries?.map(({ channel, dueNow, dueAt, nextDueAt }) => ({
      channel,
      dueNow,
      dueAt,
      nextDueAt,
    }));
    expect(
      cadenceBeat.accepted ?? 0,
      `edited-speed cadence beat accepted no canonical claim; `
      + `builtClaims=${cadenceBeat.builtClaims}; outcomes=${JSON.stringify(cadenceBeat.outcomes)}; `
      + `schedule=${JSON.stringify(cadenceEntries)}`,
    ).toBeGreaterThan(0);
    const authoritativeTrays =
      cadenceBeat.operationalProjection?.counters?.traysOnLine;
    const authoritativeBatches =
      cadenceBeat.operationalProjection?.counters?.batchesReady;
    expect(authoritativeTrays).toEqual(expect.any(Number));
    expect(authoritativeBatches).toEqual(expect.any(Number));
    const syncAckBeforeWake = await recoveryStatus.getAttribute(
      "data-foreground-sync-ack",
    );
    const wakeClaimChannels: string[] = [];
    const recordWakeClaim = (request: Request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith("/api/sync/auto-track/claim")
      )
        return;
      const claim = request.postDataJSON()?.claim as
        { channel?: string } | undefined;
      if (
        claim?.channel === "tray-produce" ||
        claim?.channel === "batch-consume"
      ) {
        wakeClaimChannels.push(claim.channel);
      }
    };
    page.on("request", recordWakeClaim);
    // The fixture tick above accepts a simulated visible interval, but the
    // canonical projection deliberately keeps its server timestamp on wall
    // time. Do not wait for wall time to catch up with the synthetic client
    // clock or rewind the page clock before waking; keep the browser timeline
    // monotonic and let the wake reconcile against the real server snapshot.
    const latestServerSnapshot = await readLiveRunSnapshot(page);
    const latestServerTimeMs = Number(
      latestServerSnapshot.operationalProjection?.serverTimeMs ?? 0,
    );
    expect(latestServerTimeMs).toBeGreaterThan(0);
    const finalWakeAt = Math.max(
      nextVisibleIntervalAt + 1,
      latestServerTimeMs,
    );
    expect(finalWakeAt).toBeGreaterThan(nextVisibleIntervalAt);
    await mockDateNow(page, finalWakeAt, { tick: false });
    const finalWakeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/sync/today",
    );
    await simulateScreenOff(page);
    await simulateWake(page);
    await expect
      .poll(() => recoveryStatus.getAttribute("data-foreground-sync-ack"), {
        timeout: 10_000,
        message:
          "wake did not acknowledge shared sync after releasing its fence",
      })
      .not.toBe(syncAckBeforeWake);
    // With server authority enabled, the browser must never duplicate the
    // server beat by issuing its retired client-side dough claims.
    expect(
      wakeClaimChannels,
      "authoritative wake emitted browser claims",
    ).toEqual([]);
    await expect
      .poll(() => readDoughCounters(page), {
        timeout: 10_000,
        message: "post-wake dough cadence did not use the edited speed",
      })
      .toEqual({
        trays: authoritativeTrays,
        batches: authoritativeBatches,
      });
    // The foreground-sync acknowledgment is the wake boundary. Verify the
    // authoritative server snapshot below instead of waiting on a secondary
    // local snapshot push after the wake.
    page.off("request", recordWakeClaim);
    const finalWakeResponse = await finalWakeResponsePromise;
    expect(finalWakeResponse.ok()).toBe(true);
    const finalWakePayload = (await finalWakeResponse.json()) as {
      operationalProjection?: {
        runId?: string;
        counters?: {
          traysOnLine?: number;
          batchesReady?: number;
          casesCompleted?: number;
        };
        calc?: {
          casesOnLine?: number;
          batchesNeeded?: number;
          traysNeeded?: number;
        };
      } | null;
      data?: {
        operationalProjection?: {
          runId?: string;
          counters?: {
            traysOnLine?: number;
            batchesReady?: number;
            casesCompleted?: number;
          };
          calc?: {
            casesOnLine?: number;
            batchesNeeded?: number;
            traysNeeded?: number;
          };
        } | null;
      };
    };

    const snapshot = await readLiveRunSnapshot(page);
    const values = snapshot.values;
    await page.locator('[data-testid="tab-run"]').click();
    const casesCompleted =
      Number(values.skidsCompleted ?? 0) * Number(values.casesPerSkid ?? 0) +
      Number(values.casesOnCurrentSkid ?? 0);
    expect(
      casesCompleted,
      "visible case count must match the live run payload",
    ).toBe(await readCaseTotal(page));
    expect(
      casesCompleted,
      "the new speed has not reached the freezer exit yet",
    ).toBe(0);
    expect(values.speedAdjustment).toBe(0.5);
    expect(values.traysOnLine).toBe(authoritativeTrays);
    expect(values.batchesReady).toBe(authoritativeBatches);
    // The final wake adopts a fresh server-time projection without rewinding
    // the fixture clock from its simulated cadence time.
    const postWakeSnapshot = await readLiveRunSnapshot(page);
    const postWakeValues = postWakeSnapshot.values;
    const wakeProjection =
      finalWakePayload.operationalProjection ??
      finalWakePayload.data?.operationalProjection;
    expect(wakeProjection?.runId).toBe(postWakeSnapshot.runId);
    expect(wakeProjection?.counters?.traysOnLine).toBe(authoritativeTrays);
    expect(wakeProjection?.counters?.batchesReady).toBe(authoritativeBatches);
    expect(wakeProjection?.counters?.casesCompleted).toBe(
      Number(postWakeValues.skidsCompleted ?? 0) * Number(postWakeValues.casesPerSkid ?? 0) +
        Number(postWakeValues.casesOnCurrentSkid ?? 0),
    );
    expect(postWakeValues.speedAdjustment).toBe(0.5);
    const currentProjection = postWakeSnapshot.operationalProjection;
    expect(currentProjection?.runId).toBe(postWakeSnapshot.runId);
    expect(currentProjection?.counters?.traysOnLine).toBe(postWakeValues.traysOnLine);
    expect(currentProjection?.counters?.batchesReady).toBe(postWakeValues.batchesReady);
    expect(currentProjection?.counters?.casesCompleted).toBe(
      Number(postWakeValues.skidsCompleted ?? 0) * Number(postWakeValues.casesPerSkid ?? 0) +
        Number(postWakeValues.casesOnCurrentSkid ?? 0),
    );
    const confirmedCalc = currentProjection?.calc;
    expect(confirmedCalc?.casesOnLine).toEqual(expect.any(Number));
    expect(confirmedCalc?.batchesNeeded).toEqual(expect.any(Number));
    expect(confirmedCalc?.traysNeeded).toEqual(expect.any(Number));
    await page.locator('[data-testid="tab-dough"]').click();
    await page
      .getByText("Machine Times", { exact: true })
      .waitFor({ state: "visible" });
    await expect(page.getByTestId("output-batches-needed")).toHaveText(
      confirmedCalc!.batchesNeeded!.toFixed(2),
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("output-trays-needed")).toHaveText(
      confirmedCalc!.traysNeeded!.toFixed(0),
      { timeout: 20_000 },
    );
    await expect(page.locator('input[name="traysOnLine"]')).toHaveValue(
      String(authoritativeTrays),
    );
    await expect(page.locator('input[name="batchesReady"]')).toHaveValue(
      String(authoritativeBatches),
    );

    await page.locator('[data-testid="tab-run"]').click();
    const currentPressText = await page
      .getByTestId("text-press-cases-left")
      .textContent();
    const currentPressCasesLeft = Number(
      currentPressText?.match(/^(\d+)/)?.[1],
    );
    expect(
      Number.isFinite(currentPressCasesLeft),
      "Press cases left should be visible and numeric",
    ).toBe(true);
    // Finish time must use the same live press-left value and adjusted 30 PPM
    // cadence that the visible case count uses.
    const adjustedFinishSec = (currentPressCasesLeft * 6 * 60) / 30;
    const finishMinutes = Math.floor(adjustedFinishSec / 60);
    const finishSeconds = Math.round(adjustedFinishSec % 60);
    const expectedFinish = await page.evaluate(
      (timestamp) =>
        new Date(timestamp).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
      finalWakeAt + adjustedFinishSec * 1000,
    );
    const finishPanels = await page
      .getByText("Est. Finish", { exact: true })
      .evaluateAll((elements) =>
        elements.map((element) => element.parentElement?.innerText ?? ""),
      );
    expect(
      finishPanels.some((text) =>
        text.includes(`${finishMinutes}m ${finishSeconds}s`),
      ),
      finishPanels.join(" | "),
    ).toBe(true);
    expect(
      finishPanels.some((text) => text.includes(expectedFinish)),
      finishPanels.join(" | "),
    ).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("speed-adjustment-after-wake.png"),
      fullPage: true,
    });
  });

  test(
    "offline wake waits for reconnect acknowledgement before sending tray and batch claims",
    async ({ page }) => {
      test.slow();
      const safeBaseMs = await setupAndStartRun(
        page,
        "10",
        DEFAULT_MANAGER_CAPABILITIES,
        {
          initialDoughCounters: { trays: 10, batches: 2 },
          pauseBeforeReturn: true,
        },
      );

      // Establish the clean reconnect cadence while the run is paused. The
      // setup helper seeded the same known inventory before its first tick;
      // this acknowledged correction ensures the edited machine times and
      // dough baseline are canonical before the speed-change journey.
      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page, {
        "input-mixerLowSec": "0",
        "input-mixerHighSec": "0",
        "input-hopperSec": "0",
      });
      await seedDoughCounters(page, { trays: 10, batches: 2 }, {
        pauseWhileSeeding: true,
      });
      await page.locator('[data-testid="tab-run"]').click();
      const lineSetupDetails = page.locator("details").filter({
        has: page.locator("summary", { hasText: /line.?setup/i }),
      }).first();
      if (!(await lineSetupDetails.evaluate((element) => (element as HTMLDetailsElement).open))) {
        await lineSetupDetails.locator("summary").click();
      }
      const speedInput = page.getByTestId("input-speedAdjustment").filter({ visible: true }).first();
      await expect(speedInput).toBeVisible();
      await waitForSyncWritesToDrain(page);
      const speedEditedAt = Math.max(safeBaseMs + 1_000, Date.now() + 60_000);
      await mockDateNow(page, speedEditedAt, { tick: false });
      await speedInput.fill("0.5");
      await speedInput.blur();
      await expect.poll(async () => {
        const snapshot = await readLiveRunSnapshot(page);
        return snapshot.values.speedAdjustment;
      }, { timeout: 15_000 }).toBe(0.5);
      await waitForSyncWritesToDrain(page);

      await page.locator('[data-testid="tab-dough"]').click();
      await page.getByText("Machine Times", { exact: true }).waitFor({ state: "visible" });
      await setMachineTimes(page, {
        "input-mixerLowSec": "0",
        "input-mixerHighSec": "0",
        "input-hopperSec": "0",
      });
      await seedDoughCounters(page, { trays: 10, batches: 2 });
      await resumeDoughTrackingIfVisible(page);
      await page.locator('[data-testid="tab-run"]').click();
      // The direct server snapshot below acknowledges these values; do not
      // add a separate queue-idle prerequisite to the reconnect scenario.
      await expect.poll(async () => {
        const snapshot = await readLiveRunSnapshot(page);
        return {
          speedAdjustment: snapshot.values.speedAdjustment,
          traysOnLine: snapshot.values.traysOnLine,
          batchesReady: snapshot.values.batchesReady,
        };
      }, { timeout: 15_000 }).toEqual({
        speedAdjustment: 0.5,
        traysOnLine: 10,
        batchesReady: 2,
      });

    const recoveryStatus = page.getByTestId("foreground-recovery-status");
    await expect(recoveryStatus).toBeVisible({ timeout: 15_000 });
    const ackBeforeOffline = Number(
      await recoveryStatus.getAttribute("data-foreground-sync-ack"),
    );
    expect(
      ackBeforeOffline,
      "initial foreground sync must be acknowledged",
    ).toBeGreaterThan(0);

    let holdRecoveryPull = false;
    let recoveryPullHeld = false;
    let releaseRecoveryPull!: () => void;
    const recoveryPullReleased = new Promise<void>((resolve) => {
      releaseRecoveryPull = resolve;
    });
    let markRecoveryPullStarted!: () => void;
    const recoveryPullStarted = new Promise<void>((resolve) => {
      markRecoveryPullStarted = resolve;
    });

    // This is the production reconciliation GET. Holding it after the
    // browser comes back online proves the claim fence does not fall back to
    // a local timer or a direct sync write.
    await page.route("**/api/sync/today**", async (route) => {
      if (
        holdRecoveryPull &&
        !recoveryPullHeld &&
        route.request().method() === "GET"
      ) {
        recoveryPullHeld = true;
        markRecoveryPullStarted();
        await recoveryPullReleased;
      }
      await route.continue();
    });

    const claimAcks: Array<{ channel: string; ack: number }> = [];
    const recordClaim = async (request: Request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith("/api/sync/auto-track/claim")
      )
        return;
      const body = request.postDataJSON() as {
        claim?: { channel?: string };
      };
      const channel = body.claim?.channel;
      if (channel === "tray-produce" || channel === "batch-consume") {
        claimAcks.push({
          channel,
          ack: Number(
            await recoveryStatus.getAttribute("data-foreground-sync-ack"),
          ),
        });
      }
    };
    page.on("request", recordClaim);

    // The server remains authoritative while this display is offline. The
    // sleeping browser must issue no claims; reconnect adopts the canonical
    // server result through the foreground barrier.
    await page.context().setOffline(true);
    await simulateScreenOff(page);
      // Keep the fake clock monotonic after the later speed edit.
      const wakeAt = speedEditedAt + 2_100;
    await mockDateNow(page, wakeAt);
    await simulateWake(page);
    await expect(recoveryStatus).toContainText(
      "Couldn't confirm the current production state",
      { timeout: 10_000 },
    );
    await page.waitForTimeout(600);
    expect(claimAcks, "offline wake must not send claims").toEqual([]);
    expect(
      Number(await recoveryStatus.getAttribute("data-foreground-sync-ack")),
      "offline wake must not advance the shared-sync acknowledgement",
    ).toBe(ackBeforeOffline);

    // Restore connectivity, but keep the canonical foreground pull pending.
    // The online event is the reconnect path used by the production app.
    holdRecoveryPull = true;
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await recoveryPullStarted;
    await page.waitForTimeout(600);
    expect(
      claimAcks,
      "claims must wait while reconnect reconciliation is held",
    ).toEqual([]);
    expect(
      Number(await recoveryStatus.getAttribute("data-foreground-sync-ack")),
      "claims must wait for the current reconnect acknowledgement",
    ).toBe(ackBeforeOffline);

    // Release only the canonical pull. The app increments its
    // acknowledgement and adopts the server-owned dough mutations.
    holdRecoveryPull = false;
    releaseRecoveryPull();
    const ackAfterReconnectHandle = await page.waitForFunction(
      (before) => {
        const raw = document
          .querySelector('[data-testid="foreground-recovery-status"]')
          ?.getAttribute("data-foreground-sync-ack");
        const value = Number(raw);
        return Number.isFinite(value) && value > before ? value : false;
      },
      ackBeforeOffline,
      {
        timeout: 10_000,
        message: "reconnect did not publish a current sync acknowledgement",
      },
    );
    const ackAfterReconnect =
      (await ackAfterReconnectHandle.jsonValue()) as number;
    await ackAfterReconnectHandle.dispose();

    // Advance one more authoritative cadence. This is an explicit E2E server
    // beat, not a browser claim.
    await mockDateNow(page, wakeAt + 2_100);
    await page.waitForTimeout(500);

    // The held-pull checks above prove no claim escaped before the current
    // canonical acknowledgement. Online client-owned claims may resume after
    // adoption, but none may be tagged with an older baseline.
    expect(
      claimAcks.every(({ ack }) => ack >= ackAfterReconnect),
      "post-reconnect claims must follow the acknowledged canonical baseline",
    ).toBe(true);
    expect(ackAfterReconnect).toBeGreaterThan(ackBeforeOffline);
    page.off("request", recordClaim);

    // A foreground sync PUT may still settle between the first beat and this
    // read. Publish one final authoritative frame at the same frozen clock,
    // then compare its counters with the server-visible live row. The request
    // listener above still proves no browser tray/batch claims were sent.
    const settledBeat = await mockDateNow(page, wakeAt + 2_100);
    await expect
      .poll(
        async () => {
          const snapshot = await readLiveRunSnapshot(page);
          return {
            trays: snapshot.values.traysOnLine,
            batches: snapshot.values.batchesReady,
          };
        },
        { timeout: 12_000 },
      )
      .toEqual({
        trays: settledBeat.operationalProjection?.counters?.traysOnLine,
        batches: settledBeat.operationalProjection?.counters?.batchesReady,
      });
  });

  test("two live sessions converge through visible retry after an offline wake", async ({
    page,
    browser,
  }: { page: Page; browser: Browser }, testInfo) => {
    test.slow();
    const contextDiagnostics = {
      active: {
        consoleWarnings: 0,
        consoleErrors: 0,
        pageErrors: 0,
        failedRequests: 0,
      },
      sleeping: {
        consoleWarnings: 0,
        consoleErrors: 0,
        pageErrors: 0,
        failedRequests: 0,
      },
    };
  type CounterSnapshot = {
    skidsCompleted: number;
    casesOnCurrentSkid: number;
    traysOnLine: number;
    batchesReady: number;
  };
  let counterSnapshots: Record<string, CounterSnapshot> | null = null;
  let syncMetadataDiagnostics: Record<string, unknown> | null = null;
  const readCounterSnapshot = (
    values: Record<string, number | string | boolean | null | undefined>,
  ): CounterSnapshot => ({
    skidsCompleted: Number(values.skidsCompleted ?? 0),
    casesOnCurrentSkid: Number(values.casesOnCurrentSkid ?? 0),
    traysOnLine: Number(values.traysOnLine ?? 0),
    batchesReady: Number(values.batchesReady ?? 0),
  });
    const observeSanitizedDiagnostics = (
      observedPage: Page,
      diagnostics: typeof contextDiagnostics.active,
    ) => {
      observedPage.on("console", (message) => {
        if (message.type() === "warning") diagnostics.consoleWarnings += 1;
        if (message.type() === "error") diagnostics.consoleErrors += 1;
      });
      observedPage.on("pageerror", () => {
        diagnostics.pageErrors += 1;
      });
      observedPage.on("requestfailed", () => {
        diagnostics.failedRequests += 1;
      });
    };
    observeSanitizedDiagnostics(page, contextDiagnostics.active);
    const safeBaseMs = await setupAndStartRun(
      page,
      "10",
      DEFAULT_MANAGER_CAPABILITIES,
    );
    const activeStatus = page.getByTestId("foreground-recovery-status");
    await expect(activeStatus).toContainText("Latest production snapshot received.", {
      timeout: 20_000,
    });

    const peer = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const sleepingPage = await peer.newPage();
    observeSanitizedDiagnostics(sleepingPage, contextDiagnostics.sleeping);
    const observedClaims: string[] = [];
    const recordClaim = (request: Request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith("/api/sync/auto-track/claim")
      )
        return;
      const body = request.postDataJSON() as { claim?: { channel?: string } };
      if (body.claim?.channel) observedClaims.push(body.claim.channel);
    };
    let blockedSyncEventStreamConnections = 0;

    try {
      // Install before navigation: routing after EventSource opens does not
      // terminate an already-established stream or prevent a queued frame.
      await sleepingPage.route("**/api/sync/events**", async (route) => {
        blockedSyncEventStreamConnections += 1;
        await route.abort();
      });
      await sleepingPage.goto("/", { waitUntil: "domcontentloaded" });
      await sleepingPage
        .getByTestId("tab-run")
        .waitFor({ state: "visible", timeout: 20_000 });
      await sleepingPage
        .getByRole("button", { name: /stop.?run/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await expect
        .poll(() => blockedSyncEventStreamConnections, {
          timeout: 10_000,
          message: "the sleeping peer's sync event stream was not blocked",
        })
        .toBeGreaterThan(0);
      await installHiddenMock(sleepingPage);
      const stale = await readLiveRunSnapshot(sleepingPage);
      const staleOperational = {
        skidsCompleted: stale.values.skidsCompleted,
        casesOnCurrentSkid: stale.values.casesOnCurrentSkid,
        traysOnLine: stale.values.traysOnLine,
        batchesReady: stale.values.batchesReady,
      };
      sleepingPage.on("request", recordClaim);
      await simulateScreenOff(sleepingPage);
      await peer.setOffline(true);
      const persistedBeforeOfflineRecovery = await readPersistedRunValues(
        sleepingPage,
        stale.runId,
      );
      const persistedBeforeOfflineRecoveryOperational = {
        skidsCompleted: persistedBeforeOfflineRecovery.skidsCompleted,
        casesOnCurrentSkid: persistedBeforeOfflineRecovery.casesOnCurrentSkid,
        traysOnLine: persistedBeforeOfflineRecovery.traysOnLine,
        batchesReady: persistedBeforeOfflineRecovery.batchesReady,
      };

      const advancedAt = safeBaseMs + 16 * 60_000;
      // Advance canonical state on the server without making the active
      // browser replay 16 minutes of local auto-track claims. This case tests
      // sync convergence and the sleeping peer's visible retry; client-side
      // catch-up is covered by the dedicated auto-track cases.
      await tickServerWithoutAdvancingBrowserClock(page, advancedAt);
      await simulateOnlineWake(page);
      await expect
        .poll(
          async () => {
            const snapshot = await readLiveRunSnapshot(page);
            const serverCounters = readCounterSnapshot(snapshot.values);
            const activeCounters = readCounterSnapshot(
              await readPersistedRunValues(page, stale.runId),
            );
            counterSnapshots = {
              serverBeforePeerRecovery: serverCounters,
              activeLocalBeforePeerRecovery: activeCounters,
            };
            const localMetadata = await page.evaluate((runId) => {
              const readRecord = (key: string): Record<string, unknown> => {
                try {
                  const raw = localStorage.getItem(key);
                  const parsed = raw ? JSON.parse(raw) : {};
                  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? parsed as Record<string, unknown>
                    : {};
                } catch {
                  return {};
                }
              };
              const updatedAt = readRecord("run-calc-runvalues-updated")[runId];
              const packagingProgress = readRecord("run-calc-packaging-progress")[runId];
              const syncButton = document.querySelector('[data-testid="sync-status-button"]');
              const recoveryStatus = document.querySelector('[data-testid="foreground-recovery-status"]');
              return {
                localRunValuesUpdatedAt:
                  typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : null,
                localPackagingProgress:
                  packagingProgress && typeof packagingProgress === "object"
                    ? packagingProgress
                    : null,
                syncStatus: syncButton?.getAttribute("aria-label") ?? null,
                syncConnection: syncButton?.getAttribute("title") ?? null,
                foregroundRecoveryState:
                  recoveryStatus?.getAttribute("data-foreground-recovery-state") ?? null,
                foregroundSyncAck:
                  recoveryStatus?.getAttribute("data-foreground-sync-ack") ?? null,
              };
            }, stale.runId);
            syncMetadataDiagnostics = {
              serverRunValuesUpdatedAt: snapshot.runValuesUpdatedAt,
              serverPackagingProgress: snapshot.packagingProgress,
              ...localMetadata,
            };
            const serverAdvanced = (
              Number(snapshot.values.casesOnCurrentSkid ?? 0) +
              Number(snapshot.values.skidsCompleted ?? 0) * 10
            ) > (
              Number(staleOperational.casesOnCurrentSkid ?? 0) +
              Number(staleOperational.skidsCompleted ?? 0) * 10
            );
            return serverAdvanced
              && JSON.stringify(serverCounters) === JSON.stringify(activeCounters);
          },
          {
            timeout: 15_000,
            message: "active session did not settle its local counters with canonical Packaging",
          },
        )
        .toBe(true);
      const canonicalAfterAdvance = await readLiveRunSnapshot(page);

      await mockDateNow(sleepingPage, advancedAt, { tick: false });
      await simulateWake(sleepingPage);
      const sleepingStatus = sleepingPage.getByTestId(
        "foreground-recovery-status",
      );
      await expect(sleepingStatus).toContainText(
        "Couldn't confirm the current production state",
        { timeout: 10_000 },
      );
      await expect(
        sleepingPage.getByTestId("button-retry-foreground-recovery"),
      ).toBeVisible();
      const failedAck = Number(
        await sleepingStatus.getAttribute("data-foreground-sync-ack"),
      );
      await sleepingPage.waitForTimeout(1_200);
      const stillFenced = await readPersistedRunValues(
        sleepingPage,
        stale.runId,
      );
      expect(
        {
          skidsCompleted: stillFenced.skidsCompleted,
          casesOnCurrentSkid: stillFenced.casesOnCurrentSkid,
          traysOnLine: stillFenced.traysOnLine,
          batchesReady: stillFenced.batchesReady,
        },
        "failed recovery changed the sleeping peer's persisted Packaging or Dough progress",
      ).toEqual(persistedBeforeOfflineRecoveryOperational);
      expect(
        observedClaims,
        "offline recovery emitted automatic claims",
      ).toEqual([]);

      let failFirstOnlinePull = true;
      let holdOnlineRecovery = true;
      await sleepingPage.route("**/api/sync/today**", async (route) => {
        if (route.request().method() === "GET" && holdOnlineRecovery) {
          if (failFirstOnlinePull) failFirstOnlinePull = false;
          await route.abort("connectionfailed");
          return;
        }
        await route.continue();
      });
      await peer.setOffline(false);
      await sleepingPage.evaluate(() =>
        window.dispatchEvent(new Event("online")),
      );
      await expect
        .poll(() => failFirstOnlinePull, {
          timeout: 10_000,
          message: "the controlled first online recovery pull did not run",
        }).toBe(false);
        await expect(sleepingStatus)
          .toContainText("Couldn't confirm the current production state", { timeout: 10_000 });
        expect(Number(await sleepingStatus.getAttribute("data-foreground-sync-ack")))
          .toBe(failedAck);
        expect(observedClaims, "failed online recovery emitted automatic claims").toEqual([]);

        holdOnlineRecovery = false;
        await sleepingPage.unroute("**/api/sync/today**");
        // Do not click Retry. A visible app must recover on the fixed five-second
        // cadence even when the browser's online signal was false or premature.
        // Advance only the proxied browser clock past the retry deadline; real
        // timers remain active and no authoritative server tick is triggered.
        await mockDateNow(sleepingPage, advancedAt + 6_000, { tick: false });
        await expect(sleepingStatus).toHaveAttribute(
          "data-foreground-recovery-state",
          "outcome",
          { timeout: 20_000 },
        );
        await expect(sleepingStatus)
          .toContainText("Latest production snapshot received.", { timeout: 20_000 });
        await expect.poll(async () =>
          Number(await sleepingStatus.getAttribute("data-foreground-sync-ack")),
        { timeout: 20_000 }).toBeGreaterThan(failedAck);

        const expected = {
          skidsCompleted: canonicalAfterAdvance.values.skidsCompleted,
          casesOnCurrentSkid: canonicalAfterAdvance.values.casesOnCurrentSkid,
          traysOnLine: canonicalAfterAdvance.values.traysOnLine,
          batchesReady: canonicalAfterAdvance.values.batchesReady,
        };
        await expect.poll(async () => {
          const values = await readPersistedRunValues(sleepingPage, stale.runId);
          return {
            skidsCompleted: values.skidsCompleted,
            casesOnCurrentSkid: values.casesOnCurrentSkid,
            traysOnLine: values.traysOnLine,
            batchesReady: values.batchesReady,
          };
        }, {
          timeout: 15_000,
          message: "visible retry did not adopt the active session's canonical state",
        }).toEqual(expected);
        expect(
          observedClaims.filter((channel) =>
            channel === "sauce-barrel" || /^app[1-4]-batch$/.test(channel)
          ),
          "recovery duplicated Sauce or Frontline claims",
        ).toEqual([]);

        const activeFinal = await readPersistedRunValues(page, stale.runId);
        const peerFinal = await readPersistedRunValues(sleepingPage, stale.runId);
        const serverFinal = await readLiveRunSnapshot(page);
        counterSnapshots = {
          canonicalAfterAdvance: readCounterSnapshot(canonicalAfterAdvance.values),
          serverAtFinal: readCounterSnapshot(serverFinal.values),
          activeLocal: readCounterSnapshot(activeFinal),
          sleepingLocal: readCounterSnapshot(peerFinal),
        };
        expect({
          skidsCompleted: peerFinal.skidsCompleted,
          casesOnCurrentSkid: peerFinal.casesOnCurrentSkid,
          traysOnLine: peerFinal.traysOnLine,
          batchesReady: peerFinal.batchesReady,
        },
        "both live sessions must finish on the same operational counters",
      ).toEqual({
        skidsCompleted: activeFinal.skidsCompleted,
        casesOnCurrentSkid: activeFinal.casesOnCurrentSkid,
        traysOnLine: activeFinal.traysOnLine,
        batchesReady: activeFinal.batchesReady,
      });

      await testInfo.attach("offline-wake-retry-summary.json", {
        body: JSON.stringify(
          {
            result: "pass",
            devices: ["desktop-active", "phone-sleeping"],
            failedRecoveryVisible: true,
            retryAdoptedCanonicalState: true,
            duplicateSauceOrFrontlineClaims: 0,
            hiddenProgressWhileFenced: 0,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } catch (error) {
      const syncDiagnosticCodes = await readSanitizedSyncDiagnosticCodes(page);
      console.info(
        "[offline-wake-counter-diagnostics]",
        JSON.stringify(counterSnapshots),
      );
      console.info(
        "[offline-wake-sync-diagnostic-codes]",
        JSON.stringify(syncDiagnosticCodes),
      );
      console.info(
        "[offline-wake-sync-metadata-diagnostics]",
        JSON.stringify(syncMetadataDiagnostics),
      );
      await testInfo.attach("offline-wake-retry-failure-diagnostics.json", {
        body: JSON.stringify(
          {
            environment: "isolated-test",
            flow: "two-session-offline-wake-visible-retry",
            dataClass: "fixture",
            sanitization:
              "Synthetic fixture counters, run-value timestamps, packaging-register counters, and UI sync status only; console text, errors, URLs, request payloads, headers, cookies, and unrelated operational values omitted.",
            contexts: contextDiagnostics,
            counterSnapshots,
            syncDiagnosticCodes,
            syncMetadataDiagnostics,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      throw error;
    } finally {
      sleepingPage.off("request", recordClaim);
      await peer.setOffline(false).catch(() => {});
      await peer.close();
    }
  });

  test("C. disconnected sleeping peer adopts remote Stop before stale recovery writes and after reload", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.slow();
    const profileBrand = `Wake ${uid()}`;
    const profileFlavor = "Peer Flavor";
    const profileKey = `${profileBrand.toLowerCase()}__${profileFlavor.toLowerCase()}`;
    const postProfile = async (
      frontlineRecipeName: string,
      updatedAt: number,
    ) => {
      const masterDataEpoch = (
        await freshMasterDataSeedHeaders(page.request, "/api/brand-profiles")
      )["X-Master-Data-Epoch"];
      if (!masterDataEpoch || !/^\d+$/.test(masterDataEpoch)) {
        throw new Error("Profile fixture seed did not receive a current master-data epoch.");
      }
      const result = await page.evaluate(
        async ({ key, name, stamp, brand, flavor, epoch }) => {
          const res = await fetch("/api/brand-profiles", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-Master-Data-Epoch": epoch,
            },
            body: JSON.stringify({
              items: [
                {
                  key,
                  brand,
                  flavor,
                  values: { frontlineRecipeName: name, app1Type: "Cheese" },
                  crustValues: {},
                  updatedAt: stamp,
                },
              ],
            }),
          });
          return { ok: res.ok, status: res.status };
        },
        {
          key: profileKey,
          name: frontlineRecipeName,
          stamp: updatedAt,
          brand: profileBrand,
          flavor: profileFlavor,
          epoch: masterDataEpoch,
        },
      );
      expect(result).toEqual({ ok: true, status: 200 });
    };

    const safeBaseMs = await setupAndStartRun(
      page,
      "10",
      DEFAULT_MANAGER_CAPABILITIES,
    );
    // setupAndStartRun deliberately exercises the same focus path used by a
    // returning PWA. Let that initial reconciliation settle before this
    // scenario starts the second device, so Device A's Stop is an ordinary
    // lifecycle action rather than part of test setup.
    const recoveryStatus = page.getByTestId("foreground-recovery-status");
    await expect(recoveryStatus).toContainText(
      "Latest production snapshot received.",
      { timeout: 20_000 },
    );
    // This scenario exercises manager-only profile/factory APIs. Other
    // screen-wake cases intentionally run as floor staff.
    // Browser time is deliberately fixed at 21:00 for this clock suite.
    // Keep profile LWW stamps ahead of real Node time so the peer's mocked
    // clock cannot make an older remote profile look stale.
    const profileStamp = Date.now() + 4 * 60 * 60_000;
    await postProfile("Wake Sauce V1", profileStamp);

    // A second independent context has its own in-memory caches, but shares
    // this manager's authenticated cookie. It is the sleeping tablet.
    const peer = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const sleepingPage = await peer.newPage();
      await sleepingPage.goto("/", { waitUntil: "domcontentloaded" });
      await sleepingPage
        .locator('[data-testid="tab-run"]')
        .waitFor({ state: "visible", timeout: 20_000 });
      await sleepingPage
        .getByRole("button", { name: /stop.?run/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await sleepingPage.evaluate((key) => {
        localStorage.setItem(
          `run-calc-profile-${key}`,
          JSON.stringify({
            frontlineRecipeName: "Wake Sauce V1",
            app1Type: "Cheese",
          }),
        );
      }, profileKey);
      await installHiddenMock(sleepingPage);
      await simulateScreenOff(sleepingPage);
      await peer.setOffline(true);
      await sleepingPage.waitForTimeout(300);

      const staleDayRaw = await sleepingPage.evaluate(() =>
        localStorage.getItem("run-calc-day"),
      );
      expect(
        staleDayRaw,
        "sleeping peer should persist its running copy",
      ).toBeTruthy();

      // Force a stale queued write while the sleeping browser is offline.
      // It carries the old running lifecycle and must be invalidated/rebuilt
      // after foreground reconciliation rather than retried after the Stop.
      await sleepingPage
        .locator('[data-testid="input-cycleSpeed"]')
        .evaluate((el) => {
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
      await page
        .getByRole("button", { name: /stop.?run/i })
        .first()
        .click();
      await page.waitForFunction(
        async () => {
          const response = await fetch(
            `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
            {
              cache: "no-store",
            },
          );
          const body = (await response.json()) as {
            dayState?: { runs?: Array<{ endedAt?: number }> };
          };
          return (
            body.dayState?.runs?.some(
              (run) => typeof run.endedAt === "number",
            ) ?? false
          );
        },
        undefined,
        { timeout: 15_000 },
      );
      await postProfile("Wake Sauce V2", profileStamp + 10_000);
      const factoryEpoch = (
        await freshMasterDataSeedHeaders(page.request, "/api/factory-data")
      )["X-Master-Data-Epoch"];
      if (!factoryEpoch || !/^\d+$/.test(factoryEpoch)) {
        throw new Error("Factory fixture seed did not receive a current master-data epoch.");
      }
      const factoryWrite = await page.evaluate(async (epoch) => {
        const res = await fetch("/api/factory-data", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "X-Master-Data-Epoch": epoch,
          },
          body: JSON.stringify({
            key: "run-calc-shift-start-time",
            value: "05:45",
          }),
        });
        return res.ok;
      }, factoryEpoch);
      expect(factoryWrite).toBe(true);

      // Keep the recovered EventSource disconnected so the only path that can
      // adopt Stop is the explicit foreground GET.
      await sleepingPage.route("**/api/sync/events**", (route) =>
        route.abort(),
      );
      await peer.setOffline(false);
      await simulateWake(sleepingPage);
      await sleepingPage
        .getByText("Ended", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      const casesAfterStop = await readCaseTotal(sleepingPage);
      await sleepingPage.waitForTimeout(2_000);
      expect(await readCaseTotal(sleepingPage)).toBe(casesAfterStop);
      await sleepingPage.waitForFunction(
        async ({ key }) => {
          const response = await fetch("/api/brand-profiles");
          const body = (await response.json()) as {
            items?: Array<{
              key: string;
              values?: { frontlineRecipeName?: string };
            }>;
          };
          return (
            body.items?.some(
              (item) =>
                item.key === key &&
                item.values?.frontlineRecipeName === "Wake Sauce V2",
            ) ?? false
          );
        },
        { key: profileKey },
        { timeout: 15_000 },
      );
      const factoryRead = await sleepingPage.evaluate(async () => {
        const res = await fetch("/api/factory-data");
        const body = (await res.json()) as {
          data?: Record<string, { value?: unknown }>;
        };
        return body.data?.["run-calc-shift-start-time"]?.value;
      });
      expect(factoryRead).toBe("05:45");

      // Let the captured retry window pass, then verify it did not replace the
      // authoritative Stop on the shared row.
      await sleepingPage.waitForTimeout(5_500);
      const sharedStillStopped = await page.evaluate(async () => {
        const res = await fetch(
          `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
          {
            cache: "no-store",
          },
        );
        const body = (await res.json()) as {
          dayState?: { runs?: Array<{ endedAt?: number }> };
        };
        return (
          body.dayState?.runs?.some((run) => typeof run.endedAt === "number") ??
          false
        );
      });
      expect(sharedStillStopped).toBe(true);
      await sleepingPage
        .getByText("Ended", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 5_000 });

      // Recreate the old running disk copy and perform a full reload. The
      // authoritative strictly-newer Stop must win again without an operator
      // tapping Stop on this device.
      await sleepingPage.unroute("**/api/sync/events**");
      await sleepingPage.evaluate((raw) => {
        if (raw) localStorage.setItem("run-calc-day", raw);
      }, staleDayRaw);
      await sleepingPage.reload({ waitUntil: "domcontentloaded" });
      await sleepingPage
        .locator('[data-testid="tab-run"]')
        .waitFor({ state: "attached", timeout: 20_000 });
      await sleepingPage
        .getByText("Ended", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      const stoppedAfterReload = await sleepingPage.evaluate(async () => {
        const res = await fetch(
          `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
          {
            cache: "no-store",
          },
        );
        const body = (await res.json()) as {
          dayState?: { runs?: Array<{ endedAt?: number }> };
        };
        return (
          body.dayState?.runs?.some((run) => typeof run.endedAt === "number") ??
          false
        );
      });
      expect(
        stoppedAfterReload,
        "reload preserved the authoritative stopped run",
      ).toBe(true);
    } finally {
      await peer.setOffline(false);
      await peer.close();
    }
  });

  test("E. one device keeps a paired Packaging correction through wake and reload", async ({
    page,
  }) => {
    test.slow();
    const autoTrackClaimChannels: string[] = [];
    const caseClaimResponses: Array<{
      receivedAt: number;
      status: number;
      outcome?: string;
    }> = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname !== "/api/sync/auto-track/claim") return;
      try {
        const body = request.postDataJSON() as { claim?: { channel?: string } };
        autoTrackClaimChannels.push(body.claim?.channel ?? "unknown");
      } catch {
        autoTrackClaimChannels.push("unreadable");
      }
    });
    page.on("response", async (response) => {
      const request = response.request();
      if (
        request.method() !== "POST"
        || new URL(response.url()).pathname !== "/api/sync/auto-track/claim"
      ) return;
      try {
        const body = request.postDataJSON() as { claim?: { channel?: string } };
        if (body.claim?.channel !== "case") return;
        const result = await response.json() as { outcome?: string };
        caseClaimResponses.push({
          receivedAt: Date.now(),
          status: response.status(),
          outcome: result.outcome,
        });
      } catch {
        caseClaimResponses.push({
          receivedAt: Date.now(),
          status: response.status(),
        });
      }
    });
    const safeBaseMs = await setupAndStartRun(page, "48");
    // Keep the browser and server clocks aligned. The isolated fixture can
    // shift the canonical run start backward, so line phases and the local
    // client-owned case tracker both observe the same elapsed time.
    const baselineAt = Date.now();
    const targetElapsedMs = 12 * 60_000 + 48_500;
    const startOffsetMs = Math.max(
      0,
      targetElapsedMs - Math.max(0, baselineAt - safeBaseMs),
    );
    await simulateScreenOff(page);
    const elapsedFixture = await page.request.post(
      `/api/sync/e2e/auto-track-tick?today=${new Date(baselineAt).toISOString().slice(0, 10)}`,
      { data: { nowMs: baselineAt, startOffsetMs, rearm: true } },
    );
    expect(
      elapsedFixture.ok(),
      `authoritative elapsed-time fixture failed: ${elapsedFixture.status()}`,
    ).toBe(true);
    await mockDateNow(page, baselineAt, { tick: false });
    await followRealDateNow(page);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, 0, 8_000);
    expect(await readCaseTotal(page)).toBe(78);

    await page.locator('[data-testid="tab-packaging"]').click();
    const skids = page.locator('[data-testid="text-skidsCompleted"]').first();
    const cases = page
      .locator('[data-testid="text-casesOnCurrentSkid"]')
      .first();
    await expect(skids).toContainText("1");
    await expect(cases).toHaveText("30");

    // Reproduce the operator's paired correction while auto tracking is live:
    // subtract one completed skid, then add fifteen cases to that same skid.
    // 1/30 -> 0/30 -> 0/45. The 48-case maximum permits the full correction.
    const correctionClaimStartIndex = caseClaimResponses.length;
    await page.locator('[data-testid="btn-dec-skidsCompleted"]').click();
    for (let i = 0; i < 15; i++) {
      await page.locator('[data-testid="btn-inc-casesOnCurrentSkid"]').click();
    }
    await expect(skids).toContainText("0");
    await expect(cases).toHaveText("45");

    let canonicalCorrectionGeneration = 0;
    await expect
      .poll(
        async () => {
          canonicalCorrectionGeneration = await page.evaluate(async () => {
            const today = new Date().toISOString().slice(0, 10);
            const response = await fetch(`/api/sync/today?today=${today}`, {
              cache: "no-store",
            });
            const body = (await response.json()) as {
              dayState?: {
                currentRunId?: string;
                runs?: Array<{ id?: string }>;
              };
              runValues?: Record<
                string,
                { skidsCompleted?: number; casesOnCurrentSkid?: number }
              >;
              packagingProgress?: Record<
                string,
                {
                  skidsCompleted?: number;
                  casesOnCurrentSkid?: number;
                  correctionGeneration?: number;
                }
              >;
            };
            const runId =
              body.dayState?.currentRunId ?? body.dayState?.runs?.[0]?.id;
            const values = runId ? body.runValues?.[runId] : undefined;
            const progress = runId
              ? body.packagingProgress?.[runId]
              : undefined;
            return runId &&
              values?.skidsCompleted === 0 &&
              values.casesOnCurrentSkid === 45 &&
              progress?.skidsCompleted === 0 &&
              progress.casesOnCurrentSkid === 45 &&
              (progress.correctionGeneration ?? 0) > 0
              ? (progress.correctionGeneration ?? 0)
              : 0;
          });
          return canonicalCorrectionGeneration;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const canonicalRunId = await page.evaluate(async () => {
      const response = await fetch(
        `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        dayState?: { currentRunId?: string; runs?: Array<{ id?: string }> };
      };
      return body.dayState?.currentRunId ?? body.dayState?.runs?.[0]?.id ?? "";
    });
    expect(
      canonicalRunId,
      "canonical correction must retain its run identity",
    ).not.toBe("");
    await waitForSyncWritesToDrain(page);

    // Let the active line run briefly, then put this only device to sleep.
    // The manual hold is intentionally still active, so wake cannot replace
    // the acknowledged pair with an automatic baseline.
    await page.waitForTimeout(1_500);
    await simulateScreenOff(page);
    const firstWakeNowMs = Date.now();
    await mockDateNow(page, firstWakeNowMs, { tick: false });
    await simulateOnlineWake(page);
    await expect(cases).toHaveText("45", { timeout: 15_000 });
    await expect(skids).toContainText("0");

    const afterWake = await page.evaluate((serverRunId) => {
      const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
        currentIndex?: number;
        runs?: Array<{ id?: string }>;
      };
      const runIds = (day.runs ?? [])
        .map((run) => run.id)
        .filter((id): id is string => Boolean(id));
      const runId = runIds.includes(serverRunId)
        ? serverRunId
        : (runIds[day.currentIndex ?? 0] ?? runIds[0]);
      const values = JSON.parse(
        localStorage.getItem(`run-calc-run-${runId}`) ?? "null",
      ) as { skidsCompleted?: number; casesOnCurrentSkid?: number } | null;
      const progressMap = JSON.parse(
        localStorage.getItem("run-calc-packaging-progress") ?? "{}",
      ) as Record<
        string,
        {
          skidsCompleted?: number;
          casesOnCurrentSkid?: number;
          correctionGeneration?: number;
        }
      >;
      return {
        values,
        progress: progressMap[runId],
        runId,
        serverRunId,
        runIds,
        keys: Object.keys(localStorage).filter((key) =>
          key.startsWith("run-calc-run-"),
        ),
      };
    }, canonicalRunId);
    expect(
      afterWake.runId,
      `local run id must match canonical ${canonicalRunId}; local keys=${afterWake.keys.join(",")}`,
    ).toBe(canonicalRunId);
    expect(afterWake.values).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 45,
    });
    expect(afterWake.progress).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 45,
      correctionGeneration: canonicalCorrectionGeneration,
    });

    const holdDeadlines = await page.evaluate(async (runId) => {
      const today = new Date().toISOString().slice(0, 10);
      const response = await fetch(`/api/sync/today?today=${today}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        packagingProgress?: Record<string, { manualOverrideUntil?: number }>;
      };
      const localProgress = JSON.parse(
        localStorage.getItem("run-calc-packaging-progress") ?? "{}",
      ) as Record<string, { manualOverrideUntil?: number }>;
      return {
        server: body.packagingProgress?.[runId]?.manualOverrideUntil ?? 0,
        local: localProgress[runId]?.manualOverrideUntil ?? 0,
      };
    }, canonicalRunId);
    const serverHold = holdDeadlines.server;
    const holdUntil = Math.max(serverHold, holdDeadlines.local);
    const holdRemaining = Math.max(0, holdUntil - Date.now() + 150);
    expect(holdRemaining, "canonical manual correction hold")
      .toBeLessThanOrEqual(60_500);
    let dueNowMs = 0;
    let clientCaseClaim: { outcome?: string } | null = null;
    await simulateScreenOff(page);
    await page.waitForTimeout(holdRemaining);
    // Keep the browser clock moving with real time while it is screen-off so
    // the local manual hold and the server's canonical hold expire together.
    const resumeNowMs = Date.now();
    await mockDateNow(page, resumeNowMs, { tick: false });
    const afterHold = await page.evaluate(async (runId) => {
      const response = await fetch(
        `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`canonical post-hold read failed: ${response.status}`);
      const body = (await response.json()) as {
        packagingProgress?: Record<string, { skidsCompleted?: number; casesOnCurrentSkid?: number }>;
      };
      return {
        cases: body.packagingProgress?.[runId]?.casesOnCurrentSkid,
        skids: body.packagingProgress?.[runId]?.skidsCompleted,
      };
    }, canonicalRunId);
    expect(afterHold.skids).toBe(0);
    expect([45, 46]).toContain(afterHold.cases);
    // A read-only snapshot avoids injecting a synthetic remote write while the
    // client-owned claim is pending; that would raise the foreground sync fence.
    const postCorrectionClaims = () =>
      caseClaimResponses.slice(correctionClaimStartIndex);
    expect(
      postCorrectionClaims().filter(
        (claim) => claim.outcome === "accepted" && claim.receivedAt < holdUntil,
      ),
      "manual suppression must not accept a client case claim before expiry",
    ).toHaveLength(0);
    await simulateOnlineWake(page);
    await waitForSyncWritesToDrain(page);
    try {
      await expect
        .poll(
          () => postCorrectionClaims().some(
            (claim) => claim.status === 200
              && claim.outcome === "accepted"
              && claim.receivedAt >= holdUntil,
          ),
          { timeout: 15_000 },
        )
        .toBe(true);
    } catch (error) {
      const browserState = await page.evaluate((runId) => {
        const w = window as unknown as {
          __testFakeMs?: number;
          __origDate?: DateConstructor;
        };
        const progress = JSON.parse(
          localStorage.getItem("run-calc-packaging-progress") ?? "{}",
        ) as Record<string, { casesOnCurrentSkid?: number; manualOverrideUntil?: number }>;
        const nextCase = [...document.querySelectorAll("span, div")]
          .map((node) => node.textContent?.trim() ?? "")
          .find((text) => text.startsWith("Next case in"));
        return {
          fakeNow: Date.now(),
          originalNow: w.__origDate?.now(),
          hidden: document.hidden,
          nextCase,
          progress: progress[runId] ?? null,
          foregroundStatus: document.querySelector(
            '[data-testid="foreground-recovery-status"]',
          )?.textContent?.trim() ?? null,
        };
      }, canonicalRunId);
      throw new Error([
        `No post-hold client case claim: ${String(error)}`,
        `holdUntil=${holdUntil}, claims=${JSON.stringify(postCorrectionClaims())}`,
        `channels=${JSON.stringify(autoTrackClaimChannels)}`,
        `browser=${JSON.stringify(browserState)}`,
      ].join("\n"));
    }
    clientCaseClaim = postCorrectionClaims().find(
      (claim) => claim.status === 200
        && claim.outcome === "accepted"
        && claim.receivedAt >= holdUntil,
    ) ?? null;
    expect(clientCaseClaim?.outcome).toBe("accepted");
    dueNowMs = Date.now();
    const readAfterDueBeat = async () => page.evaluate(async (runId) => {
      const response = await fetch(
        `/api/sync/today?today=${new Date().toISOString().slice(0, 10)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`canonical due read failed: ${response.status}`);
      const body = (await response.json()) as {
        packagingProgress?: Record<string, {
          skidsCompleted?: number; casesOnCurrentSkid?: number; manualOverrideUntil?: number;
        }>;
        runValues?: Record<string, { casesOnCurrentSkid?: number }>;
        autoTrackServerState?: {
          wallClockBookkeeping?: Record<string, { caseNextDueMs?: number; lastExpectedCases?: number }>;
        };
      };
      return {
        progress: body.packagingProgress?.[runId],
        value: body.runValues?.[runId]?.casesOnCurrentSkid,
        book: body.autoTrackServerState?.wallClockBookkeeping?.[runId],
      };
    }, canonicalRunId);
    const afterDueBeat = await readAfterDueBeat();
    expect(afterDueBeat.progress?.casesOnCurrentSkid, JSON.stringify({
      afterHold,
      holdUntil,
      resumeNowMs,
      clientCaseClaim,
      dueOffset: dueNowMs - baselineAt,
      holdOffset: serverHold - baselineAt,
      nextDueOffset: (afterDueBeat.book?.caseNextDueMs ?? 0) - baselineAt,
      expected: afterDueBeat.book?.lastExpectedCases,
      value: afterDueBeat.value,
    })).toBe(46);
    // The authoritative beat is the source of truth for this paired
    // correction. Rehydrate its acknowledged packaging register before
    // asserting the visible value. Preserve that beat's clock across both
    // reloads: the navigation init script otherwise resets to the original
    // run start and makes the browser appear older than the server correction.
    await page.evaluate((ms) => {
      sessionStorage.setItem("__screenOffWakeReloadMs", String(ms));
      (window as unknown as Record<string, unknown>).__testFakeMs = ms;
    }, dueNowMs || Date.now());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="tab-packaging"]')
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(cases).toHaveText("46", { timeout: 15_000 });
    await expect(skids).toContainText("0");

    // Reload is a separate persistence boundary: form, durable run values,
    // Packaging register, and canonical server state must still agree.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="tab-packaging"]')
      .waitFor({ state: "visible", timeout: 20_000 });
    await expect(
      page.locator('[data-testid="text-casesOnCurrentSkid"]').first(),
    ).toHaveText("46", { timeout: 20_000 });
    await expect(
      page.locator('[data-testid="text-skidsCompleted"]').first(),
    ).toContainText("0");

    const persisted = await page.evaluate(async (runId) => {
      const values = JSON.parse(
        localStorage.getItem(`run-calc-run-${runId}`) ?? "null",
      ) as { skidsCompleted?: number; casesOnCurrentSkid?: number } | null;
      const progressMap = JSON.parse(
        localStorage.getItem("run-calc-packaging-progress") ?? "{}",
      ) as Record<
        string,
        { skidsCompleted?: number; casesOnCurrentSkid?: number }
      >;
      const today = new Date().toISOString().slice(0, 10);
      const response = await fetch(`/api/sync/today?today=${today}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        runValues?: Record<
          string,
          { skidsCompleted?: number; casesOnCurrentSkid?: number }
        >;
        packagingProgress?: Record<
          string,
          { skidsCompleted?: number; casesOnCurrentSkid?: number }
        >;
      };
      return {
        values,
        progress: progressMap[runId],
        serverValues: body.runValues?.[runId],
        serverProgress: body.packagingProgress?.[runId],
      };
    }, canonicalRunId);
    expect(persisted.values).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 46,
    });
    expect(persisted.progress).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 46,
    });
    expect(persisted.serverValues).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 46,
    });
    expect(persisted.serverProgress).toMatchObject({
      skidsCompleted: 0,
      casesOnCurrentSkid: 46,
    });
  });

  test("F. a failed Packaging correction stays visible on phone until an explicit retry", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.setViewportSize({ width: 390, height: 844 });
    const safeBaseMs = await setupAndStartRun(page, "48");
    const baselineAt = safeBaseMs + 12 * 60_000 + 48_500;

    await simulateScreenOff(page);
    await mockDateNow(page, baselineAt);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, 0, 8_000);
    expect(await readCaseTotal(page)).toBe(78);

    await page.locator('[data-testid="tab-packaging"]').click();
    const skids = page.locator('[data-testid="text-skidsCompleted"]').first();
    const cases = page
      .locator('[data-testid="text-casesOnCurrentSkid"]')
      .first();
    await expect(skids).toContainText("1");
    await expect(cases).toHaveText("30");

    const runId = await page.evaluate(() => {
      const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
        currentRunId?: string;
        currentIndex?: number;
        runs?: Array<{ id?: string }>;
      };
      return (
        day.currentRunId ??
        day.runs?.[day.currentIndex ?? 0]?.id ??
        day.runs?.[0]?.id ??
        null
      );
    });
    expect(runId, "active run id").toBeTruthy();

    const initial = await page.waitForFunction(
      async (id) => {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`/api/sync/today?today=${today}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          runValues?: Record<
            string,
            { skidsCompleted?: number; casesOnCurrentSkid?: number }
          >;
          packagingProgress?: Record<
            string,
            {
              skidsCompleted?: number;
              casesOnCurrentSkid?: number;
              correctionGeneration?: number;
            }
          >;
        };
        const values = body.runValues?.[id];
        const progress = body.packagingProgress?.[id];
        return values?.skidsCompleted === 1 &&
          values.casesOnCurrentSkid === 30 &&
          progress?.skidsCompleted === 1 &&
          progress.casesOnCurrentSkid === 30
          ? { correctionGeneration: progress.correctionGeneration ?? 0 }
          : false;
      },
      runId,
      { timeout: 15_000 },
    );
    const initialState = (await initial.jsonValue()) as {
      correctionGeneration: number;
    };

    let blocked = true;
    let blockedWrites = 0;
    await page.route("**/api/sync/today**", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        const requestBody = JSON.parse(request.postData() ?? "{}") as {
          payload?: {
            packagingProgress?: Record<
              string,
              { correctionGeneration?: number }
            >;
          };
        };
        const progress = requestBody.payload?.packagingProgress?.[runId!];
        if (
          blocked &&
          progress &&
          (progress.correctionGeneration ?? 0) >
            initialState.correctionGeneration
        ) {
          blockedWrites += 1;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "controlled Packaging sync outage" }),
          });
          return;
        }
      }
      await route.continue();
    });

    try {
      // 1/30 -> 0/30 -> 0/45. The corrected pair must remain local while
      // every PUT carrying the correction is rejected.
      // Keep the correction on the same frozen production instant. A fixture
      // tick here can advance the automatic baseline between the paired
      // decrement clicks and make the correction appear to be overwritten.
      await mockDateNow(page, baselineAt, { tick: false });
      await page.locator('[data-testid="btn-dec-skidsCompleted"]').click();
      for (let i = 0; i < 15; i++) {
        await page
          .locator('[data-testid="btn-inc-casesOnCurrentSkid"]')
          .click();
      }
      await expect(skids).toContainText("0");
      await expect(cases).toHaveText("45");
      await expect(skids).toBeVisible();
      await expect(cases).toBeVisible();
      await expect
        .poll(() => blockedWrites, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      const localPair = await page.evaluate((id) => {
        const values = JSON.parse(
          localStorage.getItem(`run-calc-run-${id}`) ?? "{}",
        ) as { skidsCompleted?: number; casesOnCurrentSkid?: number };
        const progress = JSON.parse(
          localStorage.getItem("run-calc-packaging-progress") ?? "{}",
        ) as Record<
          string,
          { skidsCompleted?: number; casesOnCurrentSkid?: number }
        >;
        return { values, progress: progress[id] };
      }, runId);
      expect(localPair.values).toMatchObject({
        skidsCompleted: 0,
        casesOnCurrentSkid: 45,
      });
      expect(localPair.progress).toMatchObject({
        skidsCompleted: 0,
        casesOnCurrentSkid: 45,
      });

      const notAcknowledged =
        "Your latest changes are retained on this device, but the server has not acknowledged them. Other devices cannot see them until sync succeeds.";
      await expect(
        page.getByText(notAcknowledged, { exact: true }),
      ).toBeVisible({ timeout: 20_000 });

      await page.locator('button[title="Sync connected"]').click();
      await expect(
        page.getByText(
          "Your local change is retained on this device. It is not shared until the server acknowledges it.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(notAcknowledged, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Pending writes")).toBeVisible();
      const retry = page.getByRole("button", {
        name: "Retry latest retained change",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await expect(retry).toBeEnabled();
      const pendingGeometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));
      expect(pendingGeometry.documentScrollWidth).toBeLessThanOrEqual(
        pendingGeometry.viewportWidth + 1,
      );
      expect(pendingGeometry.bodyScrollWidth).toBeLessThanOrEqual(
        pendingGeometry.viewportWidth + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath("packaging-correction-pending.png"),
        fullPage: true,
      });

      blocked = false;
      await retry.click();
      await expect
        .poll(
          async () =>
            page.evaluate(async (id) => {
              const today = new Date().toISOString().slice(0, 10);
              const response = await fetch(`/api/sync/today?today=${today}`, {
                cache: "no-store",
              });
              const body = (await response.json()) as {
                runValues?: Record<
                  string,
                  { skidsCompleted?: number; casesOnCurrentSkid?: number }
                >;
                packagingProgress?: Record<
                  string,
                  { skidsCompleted?: number; casesOnCurrentSkid?: number }
                >;
              };
              const values = body.runValues?.[id];
              const progress = body.packagingProgress?.[id];
              return (
                values?.skidsCompleted === 0 &&
                values.casesOnCurrentSkid === 45 &&
                progress?.skidsCompleted === 0 &&
                progress.casesOnCurrentSkid === 45
              );
            }, runId),
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(
        page.getByText(notAcknowledged, { exact: true }),
      ).toBeHidden();

      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="tab-packaging"]')
        .waitFor({ state: "visible", timeout: 20_000 });
      await expect(
        page.locator('[data-testid="text-skidsCompleted"]').first(),
      ).toContainText("0", { timeout: 20_000 });
      await expect(
        page.locator('[data-testid="text-casesOnCurrentSkid"]').first(),
      ).toHaveText("45", { timeout: 20_000 });
      const convergedGeometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));
      expect(convergedGeometry.documentScrollWidth).toBeLessThanOrEqual(
        convergedGeometry.viewportWidth + 1,
      );
      expect(convergedGeometry.bodyScrollWidth).toBeLessThanOrEqual(
        convergedGeometry.viewportWidth + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath("packaging-correction-converged.png"),
        fullPage: true,
      });
    } finally {
      blocked = false;
      await page.unroute("**/api/sync/today**").catch(() => {});
    }
  });

  test("D. active peers and server keep a downward skid correction over a stale automatic write", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.slow();
    const safeBaseMs = await setupAndStartRun(page, "48");
    const correctedCases = 24;
    // Stay comfortably inside the 36-case bucket rather than exactly on its
    // opening millisecond; browser/start timestamp ordering can otherwise
    // leave floating-point elapsed time a fraction below 3.6 minutes.
    const baselineAt = safeBaseMs + 8 * 60_000 + 36_500;

    // At +8.6 min, 3.6 min of product has exited the five-minute tunnel:
    // floor(3.6 * 60 pizzas/min / 6 pizzas/case) = 36 cases.
    await simulateScreenOff(page);
    await mockDateNow(page, baselineAt);
    await simulateOnlineWake(page);
    await waitForCaseCounterChange(page, 0, 8_000);
    expect(await readCaseTotal(page)).toBe(36);

    // Wait until the automatic baseline and its generation-0 packaging
    // register are durably stored before the second active browser joins.
    await page.waitForFunction(
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`/api/sync/today?today=${today}`);
        const body = (await response.json()) as {
          packagingProgress?: Record<string, { casesOnCurrentSkid?: number }>;
        } | null;
        return Object.values(body?.packagingProgress ?? {}).some(
          (entry) => entry.casesOnCurrentSkid === 36,
        );
      },
      undefined,
      { timeout: 15_000 },
    );
      // The correction below is the synchronization boundary for this case.
      // Hold browser-originated automatic claims while it is applied; the
      // stale automatic write itself is sent explicitly from the peer below.
      await page.route("**/api/sync/auto-track/claim**", (route) =>
        route.abort(),
      );

    const peer = await browser.newContext({
      storageState: await page.context().storageState(),
    });
      await peer.route("**/api/sync/auto-track/claim**", (route) =>
        route.abort(),
      );
    try {
      // Install the same Date proxy before any app script runs. Both tabs are
      // active and automatic tracking is enabled, but neither can race ahead
      // merely because this test's real clock differs from startedAt.
      await peer.addInitScript(
        ({ fakeMs }) => {
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
        },
        { fakeMs: baselineAt },
      );

      const peerPage = await peer.newPage();
      await peerPage.goto("/", { waitUntil: "domcontentloaded" });
      await peerPage
        .locator('[data-testid="tile-cases-completed"]')
        .waitFor({ state: "visible", timeout: 20_000 });
      await expect
        .poll(() => readCaseTotal(peerPage), { timeout: 15_000 })
        .toBe(36);

      // Capture what the second active browser knew before the correction.
      // We later replay this as its unaware automatic tick with a newer
      // whole-run timestamp; the older correction generation must still lose.
      const staleSnapshot = await peerPage.evaluate(async () => {
        const today = new Date().toISOString().slice(0, 10);
        const response = await fetch(`/api/sync/today?today=${today}`);
        return (await response.json()) as {
          dayState?: { currentRunId?: string; runs?: Array<{ id?: string }> };
          runValues?: Record<string, Record<string, unknown>>;
          runValuesUpdatedAt?: Record<string, number>;
          packagingProgress?: Record<
            string,
            {
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
        // Keep the operator correction on the frozen automatic-baseline clock;
        // do not race a server-owned tracking beat between its twelve clicks.
        await mockDateNow(page, baselineAt, { tick: false });
        const manualSectionStatuses: number[] = [];
        const manualSectionConflictDetails: Array<Record<string, unknown>> = [];
        page.on("response", (response) => {
          if (new URL(response.url()).pathname !== "/api/sync/manual-section") return;
          const responseIndex = manualSectionStatuses.push(response.status()) - 1;
          if (response.status() !== 409) return;
          const request = response.request().postDataJSON() as {
            runId?: string;
            baseValues?: Record<string, number>;
            values?: Record<string, number>;
            observedGeneration?: string;
            resetEpoch?: number;
          };
          void response.json().then((body: {
            outcome?: string;
            canonicalRevision?: number;
            data?: {
              dayState?: {
                runs?: Array<{
                  id?: string;
                  metaUpdatedAt?: number;
                  startedAt?: number;
                }>;
              };
              runValues?: Record<string, {
                skidsCompleted?: number;
                casesOnCurrentSkid?: number;
              }>;
            };
          }) => {
            const canonicalRun = body.data?.dayState?.runs?.find(
              (candidate) => candidate.id === request.runId,
            );
            const canonicalValues = body.data?.runValues?.[request.runId ?? ""];
            manualSectionConflictDetails.push({
              responseIndex,
              outcome: body.outcome,
              canonicalRevision: body.canonicalRevision,
              requestBase: {
                skidsCompleted: request.baseValues?.skidsCompleted,
                casesOnCurrentSkid: request.baseValues?.casesOnCurrentSkid,
              },
              requestValues: {
                skidsCompleted: request.values?.skidsCompleted,
                casesOnCurrentSkid: request.values?.casesOnCurrentSkid,
              },
              requestResetEpoch: request.resetEpoch,
              canonicalGenerationMatchesRequest: canonicalRun
                ? `${canonicalRun.id ?? ""}:${canonicalRun.metaUpdatedAt ?? canonicalRun.startedAt ?? 0}` === request.observedGeneration
                : false,
              canonicalPackagingValues: {
                skidsCompleted: canonicalValues?.skidsCompleted,
                casesOnCurrentSkid: canonicalValues?.casesOnCurrentSkid,
              },
            });
          }).catch(() => {
            manualSectionConflictDetails.push({
              responseIndex,
              responseBodyAvailable: false,
            });
          });
        });
        const decrement = page.locator('[data-testid="btn-dec-casesOnCurrentSkid"]');
        for (let i = 0; i < 12; i++) await decrement.click();
        await expect.poll(() => manualSectionStatuses.length, {
          timeout: 15_000,
          message: "all 12 rapid Packaging corrections must reach the server",
        }).toBe(12);
        await expect.poll(
          () => manualSectionConflictDetails.length,
          { timeout: 5_000 },
        ).toBe(manualSectionStatuses.filter((status) => status === 409).length);
        expect(
          manualSectionStatuses,
          `Packaging correction conflicts: ${JSON.stringify(manualSectionConflictDetails)}`,
        ).toEqual(Array(12).fill(200));
        await expect(primaryCases).toHaveText("24");
        await expect(peerCases).toHaveText("24", { timeout: 15_000 });

        const staleWriteResult = await peerPage.evaluate(async ({ snapshot, id }) => {
          const payload = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
          const staleProgress = payload.packagingProgress?.[id];
          const staleValues = payload.runValues?.[id];
          if (!staleProgress || !staleValues)
            throw new Error("stale packaging snapshot missing");
          staleProgress.skidsCompleted = 0;
          staleProgress.casesOnCurrentSkid = 36;
          staleProgress.updatedAt += 30_000;
          staleValues.skidsCompleted = 0;
          staleValues.casesOnCurrentSkid = 36;
          payload.runValuesUpdatedAt ??= {};
          payload.runValuesUpdatedAt[id] = staleProgress.updatedAt;

          const epochResponse = await fetch("/api/sync/reset-epoch");
          const { epoch } = (await epochResponse.json()) as { epoch: number };
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
            body: (await response.json()) as {
              data?: {
                runValues?: Record<
                  string,
                  {
                    skidsCompleted?: number;
                    casesOnCurrentSkid?: number;
                  }
                >;
              };
            },
          };
        },
        { snapshot: staleSnapshot, id: runId! },
      );

      expect(staleWriteResult.status).toBe(200);
      expect(staleWriteResult.body.data?.runValues?.[runId!]).toMatchObject({
        skidsCompleted: 0,
        casesOnCurrentSkid: correctedCases,
      });
      await expect(primaryCases).toHaveText(String(correctedCases));
      await expect(peerCases).toHaveText(String(correctedCases));
      // The canonical Packaging pair is correct after the stale write. Verify
      // the Run summary also invalidates its older operational-calculation
      // receipt instead of continuing to display the pre-correction count.
      await page.locator('[data-testid="tab-run"]').click();
      await peerPage.locator('[data-testid="tab-run"]').click();
      await expect
        .poll(() => readCaseTotal(page), {
          timeout: 15_000,
          message: "Run summary should use the corrected Packaging count",
        })
        .toBe(correctedCases);
      await expect
        .poll(() => readCaseTotal(peerPage), {
          timeout: 15_000,
          message: "peer Run summary should use the corrected Packaging count",
        })
        .toBe(correctedCases);
      await page.locator('[data-testid="tab-packaging"]').click();
      await peerPage.locator('[data-testid="tab-packaging"]').click();

      const serverState = await page.evaluate(
        async ({ id }) => {
          const today = new Date().toISOString().slice(0, 10);
          const response = await fetch(`/api/sync/today?today=${today}`);
          const body = (await response.json()) as {
            runValues?: Record<
              string,
              {
                skidsCompleted?: number;
                casesOnCurrentSkid?: number;
              }
            >;
            packagingProgress?: Record<
              string,
              {
                skidsCompleted?: number;
                casesOnCurrentSkid?: number;
                manualOverrideUntil?: number;
              }
            >;
          };
          return {
            pair: body.runValues?.[id],
            progress: body.packagingProgress?.[id],
            manualOverrideUntil:
              body.packagingProgress?.[id]?.manualOverrideUntil,
          };
        },
        { id: runId! },
      );
      expect(serverState.pair).toMatchObject({
        skidsCompleted: 0,
        casesOnCurrentSkid: correctedCases,
      });
      expect(serverState.progress).toMatchObject({
        skidsCompleted: 0,
        casesOnCurrentSkid: correctedCases,
      });
      expect(serverState.manualOverrideUntil).toEqual(expect.any(Number));

      // Both active peers retain the correction for the canonical hold.
      await expect(peerCases).toHaveText(String(correctedCases));

      // The API intentionally evaluates manualOverrideUntil against its own
      // canonical clock. Browser Date mocking must not bypass that hold, so
      // wait for the exact server-recorded deadline before exercising the
      // first eligible automatic tick.
      const serverHoldRemaining = Math.max(
        0,
        (serverState.manualOverrideUntil ?? 0) - Date.now() + 150,
      );
      expect(
        serverHoldRemaining,
        "canonical server hold remaining",
      ).toBeLessThanOrEqual(60_500);
      await page.waitForTimeout(serverHoldRemaining);
      await expect(primaryCases).toHaveText(String(correctedCases));
      await expect(peerCases).toHaveText(String(correctedCases));
      const eligibleBeat = await mockDateNow(page, baselineAt + 6_001);
      const authoritativeCases =
        eligibleBeat.operationalProjection?.counters?.casesCompleted;
      expect(authoritativeCases).toEqual(expect.any(Number));
      await simulateWake(page);
      await expect(primaryCases).toHaveText(String(authoritativeCases), {
        timeout: 8_000,
      });
      await expect(peerCases).toHaveText(String(authoritativeCases), {
        timeout: 15_000,
      });
      // The aggregate tile lives on the Run tab; both pages are still on
      // Packaging after checking the pair above.
      await page.locator('[data-testid="tab-run"]').click();
      await peerPage.locator('[data-testid="tab-run"]').click();
      expect(await readCaseTotal(page)).toBe(authoritativeCases);
      expect(await readCaseTotal(peerPage)).toBe(authoritativeCases);
    } finally {
      await peer.close();
    }
  });

  test("@focused-only cancels a wake recovery without replaying a pre-wake write", async ({
    page,
    browser,
  }: { page: Page; browser: Browser }, testInfo) => {
    test.slow();
    const safeBaseMs = await setupAndStartRun(
      page,
      "10",
      DEFAULT_MANAGER_CAPABILITIES,
    );
    const peer = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const sleepingPage = await peer.newPage();
    const observedClaims: string[] = [];
    let blockedSyncEventStreamConnections = 0;
    const recordClaim = (request: Request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith("/api/sync/auto-track/claim")
      )
        return;
      const body = request.postDataJSON() as { claim?: { channel?: string } };
      if (body.claim?.channel) observedClaims.push(body.claim.channel);
    };
    let recoveryPullStartedCount = 0;
    let heldRecoveryPullCount = 0;
    let recoveryPullAbortedCount = 0;
    let trackRecoveryPushes = false;
    let recoveryPutCount = 0;
    const recoveryPutObservations: {
      startedDuringHeldPull: boolean;
      completedDuringHeldPull?: boolean;
      includedOfflineCycleSpeedEdit: boolean;
      outcome: "pending" | "acknowledged" | "rejected" | "failed";
      status?: number;
    }[] = [];
    const pendingRecoveryPuts = new Map<Request, (typeof recoveryPutObservations)[number]>();
    let releaseRecovery: (() => void) | undefined;
    const recoveryHeld = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const recordRecoveryPut = (request: Request) => {
      if (!trackRecoveryPushes || request.method() !== "PUT") return;
      if (new URL(request.url()).pathname === "/api/sync/today") {
        recoveryPutCount += 1;
        let includedOfflineCycleSpeedEdit = false;
        try {
          const body = request.postDataJSON() as {
            payload?: { runValues?: Record<string, { cycleSpeed?: unknown }> };
          };
          includedOfflineCycleSpeedEdit = Object.values(
            body.payload?.runValues ?? {},
          ).some((values) => values?.cycleSpeed === 31);
        } catch {
          // Record only whether the known synthetic edit was present.
        }
        const observation = {
          startedDuringHeldPull: heldRecoveryPullCount > 0,
          includedOfflineCycleSpeedEdit,
          outcome: "pending" as const,
        };
        recoveryPutObservations.push(observation);
        pendingRecoveryPuts.set(request, observation);
      }
    };
    const recordRecoveryPutResponse = (response: Response) => {
      const observation = pendingRecoveryPuts.get(response.request());
      if (!observation) return;
      observation.completedDuringHeldPull = heldRecoveryPullCount > 0;
      observation.status = response.status();
      observation.outcome = response.ok() ? "acknowledged" : "rejected";
      pendingRecoveryPuts.delete(response.request());
    };
    const recordRecoveryPutFailure = (request: Request) => {
      const observation = pendingRecoveryPuts.get(request);
      if (!observation) return;
      observation.completedDuringHeldPull = heldRecoveryPullCount > 0;
      observation.outcome = "failed";
      pendingRecoveryPuts.delete(request);
    };

    try {
      // Block the stream before it is created, so cancellation is not tested
      // against an already-delivered peer update.
      await sleepingPage.route("**/api/sync/events**", async (route) => {
        blockedSyncEventStreamConnections += 1;
        await route.abort();
      });
      await sleepingPage.goto("/", { waitUntil: "domcontentloaded" });
      await sleepingPage
        .getByTestId("tab-run")
        .waitFor({ state: "visible", timeout: 20_000 });
      await sleepingPage
        .getByRole("button", { name: /stop.?run/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      await expect
        .poll(() => blockedSyncEventStreamConnections, {
          timeout: 10_000,
          message: "the sleeping peer's sync event stream was not blocked",
        })
        .toBeGreaterThan(0);
      await installHiddenMock(sleepingPage);
      const stale = await readLiveRunSnapshot(sleepingPage);
      const cycleSpeedBeforeQueuedEdit = stale.values.cycleSpeed;
      expect(cycleSpeedBeforeQueuedEdit).toEqual(expect.any(Number));
      expect(cycleSpeedBeforeQueuedEdit).not.toBe(31);
      sleepingPage.on("request", recordClaim);
      sleepingPage.on("request", recordRecoveryPut);
      sleepingPage.on("response", recordRecoveryPutResponse);
      sleepingPage.on("requestfailed", recordRecoveryPutFailure);
      await simulateScreenOff(sleepingPage);
      await peer.setOffline(true);

      // Keep the user edit locally durable while offline. Cancellation must
      // discard this owner's pending push, not erase the user's edit.
      await sleepingPage
        .locator('[data-testid="input-cycleSpeed"]')
        .evaluate((el) => {
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
      await expect
        .poll(
          async () =>
            (await readPersistedRunValues(sleepingPage, stale.runId)).cycleSpeed,
          { timeout: 5_000, message: "offline cycle-speed edit was not saved locally" },
        )
        .toBe(31);

      await sleepingPage.route("**/api/sync/today**", async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        // Hold every canonical read. A visibility transition can supersede
        // one recovery attempt and immediately start another; holding only the
        // first would let the replacement adopt and release writes unnoticed.
        recoveryPullStartedCount += 1;
        heldRecoveryPullCount += 1;
        await recoveryHeld;
        await route.abort("aborted").catch(() => {});
        heldRecoveryPullCount = Math.max(0, heldRecoveryPullCount - 1);
        recoveryPullAbortedCount += 1;
      });
      trackRecoveryPushes = true;
      await peer.setOffline(false);
      await sleepingPage.evaluate(() =>
        window.dispatchEvent(new Event("online")),
      );
      await simulateWake(sleepingPage);
      const recoveringStatus = sleepingPage.getByTestId(
        "foreground-recovery-status",
      );
      await expect(recoveringStatus).toContainText(
        "Still recovering: checking the current production state",
        {
          timeout: 10_000,
        },
      );
      expect(
        recoveryPullStartedCount,
        "wake recovery did not reach a held canonical pull",
      ).toBeGreaterThan(0);
      await sleepingPage.waitForTimeout(750);
      const syncEventSummary = await sleepingPage.evaluate(() => {
        const diagnosticKey = Array.from(
          { length: localStorage.length },
          (_, index) => localStorage.key(index),
        ).find((key) => key?.startsWith("run-calc-sync-diagnostics:"));
        if (!diagnosticKey) return [];
        try {
          const parsed = JSON.parse(localStorage.getItem(diagnosticKey) ?? "[]");
          if (!Array.isArray(parsed)) return [];
          return parsed.slice(-12).map((event) => ({
            kind: typeof event?.kind === "string" ? event.kind : "unknown",
            message: typeof event?.message === "string" ? event.message : "",
            response: typeof event?.response === "string" ? event.response : "",
          }));
        } catch {
          return [];
        }
      });
      const recoveryPutCountWhilePullHeld = recoveryPutObservations.filter(
        (observation) => observation.startedDuringHeldPull,
      ).length;

      // Navigation unmounts the real Home effect while its pull is pending.
      // Release the route afterward so the cancelled request cannot linger.
      await sleepingPage.goto("about:blank", { waitUntil: "domcontentloaded" });
      releaseRecovery?.();
      await expect
        .poll(() => recoveryPullAbortedCount, {
          timeout: 5_000,
          message: "cancelled recovery pulls did not terminate",
        })
        .toBe(recoveryPullStartedCount);
      await sleepingPage.unroute("**/api/sync/today**");
      await sleepingPage.waitForTimeout(750);
      await expect
        .poll(
          () => recoveryPutObservations.filter(
            (observation) => observation.outcome === "pending",
          ).length,
          {
            timeout: 5_000,
            message: "a tracked sync write did not settle after recovery cancellation",
          },
        )
        .toBe(0);
      const acknowledgedDuringRecovery = recoveryPutObservations.filter(
        (observation) =>
          observation.outcome === "acknowledged"
          && (
            observation.startedDuringHeldPull
            || observation.completedDuringHeldPull
          ),
      );
      await testInfo.attach("cancelled-wake-put-observations.json", {
        body: JSON.stringify(
          {
            isolatedFixture: true,
            putCount: recoveryPutCount,
            startedDuringHeldPull: recoveryPutCountWhilePullHeld,
            acknowledgedDuringRecovery: acknowledgedDuringRecovery.length,
            observations: recoveryPutObservations,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(
        acknowledgedDuringRecovery,
        "a sync PUT was acknowledged before canonical wake adoption completed",
      ).toEqual([]);
      const canonicalBeforeRemount = await readLiveRunSnapshot(page);
      expect(canonicalBeforeRemount.values.cycleSpeed).toBe(
        cycleSpeedBeforeQueuedEdit,
      );
      expect(
        observedClaims,
        "cancelled recovery issued an automatic tracking claim before remount",
      ).toEqual([]);
      const cancelledOwnerClaims = [...observedClaims];
      trackRecoveryPushes = false;
      sleepingPage.off("request", recordRecoveryPut);
      sleepingPage.off("response", recordRecoveryPutResponse);
      sleepingPage.off("requestfailed", recordRecoveryPutFailure);
      sleepingPage.off("request", recordClaim);
      await sleepingPage.goto("/", { waitUntil: "domcontentloaded" });
      await sleepingPage
        .getByTestId("tab-run")
        .waitFor({ state: "visible", timeout: 20_000 });
      await sleepingPage
        .getByRole("button", { name: /stop.?run/i })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      // The new Home has no stranded foreground fence, and the offline edit
      // remains durable locally. Only the cancelled owner is forbidden from
      // publishing its queued snapshot.
      await expect
        .poll(
          async () => {
            const values = await readPersistedRunValues(
              sleepingPage,
              stale.runId,
            );
            return values.cycleSpeed;
          },
          {
            timeout: 15_000,
            message: "the offline cycle-speed edit was not retained across remount",
          },
        )
        .toBe(31);
      const status = sleepingPage.getByTestId("foreground-recovery-status");
      if (await status.count()) {
        await expect(status).not.toHaveAttribute(
          "data-foreground-recovery-state",
          "recovering",
        );
      }
      await testInfo.attach("cancelled-wake-recovery-summary.json", {
        body: JSON.stringify(
          {
            result: "pass",
            device: "phone-sleeping",
            cancelledRecoveryVisible: true,
            trackingFenceClearedAfterRemount: true,
            recoveryPullsHeld: recoveryPullStartedCount,
            recoveryPullsAborted: recoveryPullAbortedCount,
            cancelledOwnerPutCount: recoveryPutCount,
            acknowledgedDuringRecovery: acknowledgedDuringRecovery.length,
            offlineEditRetainedAfterRemount: true,
            cancelledOwnerAutoTrackClaims: cancelledOwnerClaims.length,
            syncEvents: syncEventSummary,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      releaseRecovery?.();
      await peer.close().catch(() => {});
    }
  });
});
