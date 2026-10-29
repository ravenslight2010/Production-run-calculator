import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEFAULT_VALUES } from "../src/types";
import { selectCanonicalFixtureRun } from "./canonical-run-selection";
import {
  AuthorizedBrowserFixtures, uniqueTestId, type AuthorizedTestAccount,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const browserIssueCounts = new WeakMap<Page, { consoleErrors: number; pageErrors: number }>();

function facilityDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

async function open(
  browser: Browser, account: AuthorizedTestAccount, baseURL: string,
  viewport: { width: number; height: number } | undefined,
): Promise<Page> {
  const context = await browser.newContext({ viewport, timezoneId: "America/Chicago" });
  await context.addCookies([{ name: "rc_auth", value: account.token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const issueCounts = { consoleErrors: 0, pageErrors: 0 };
  browserIssueCounts.set(page, issueCounts);
  page.on("console", (message) => {
    if (message.type() === "error") issueCounts.consoleErrors++;
  });
  page.on("pageerror", () => { issueCounts.pageErrors++; });
  await page.addInitScript(() => {
    const diagnostics = { opens: 0, errors: 0, messages: 0, corrections: 0 };
    Object.assign(window, { __packagingSseDiagnostics: diagnostics });
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener("open", () => { diagnostics.opens++; });
        this.addEventListener("error", () => { diagnostics.errors++; });
        this.addEventListener("message", (event) => {
          diagnostics.messages++;
          try {
            if (JSON.parse(event.data).data?.packagingProgress) diagnostics.corrections++;
          } catch {}
        });
      }
    };
  });
  await page.goto(baseURL);
  await page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 45_000 });
  await selectCanonicalFixtureRun(page);
  await page.getByTestId("tab-packaging").click();
  await page.getByTestId("text-casesOnCurrentSkid").waitFor();
  return page;
}

async function canonical(page: Page, date: string) {
  return page.evaluate(async (today) => {
    const response = await fetch(`/api/sync/today?today=${today}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Canonical read failed (${response.status})`);
    return await response.json();
  }, date);
}

test("Packaging correction and acknowledged Resume converge across tabs, reload and reconnect", async ({
  browser, playwright, baseURL,
}, testInfo) => {
  const fixtures = await AuthorizedBrowserFixtures.create(
    playwright, requireLocalFixtureApiOrigin("Packaging recovery"), process.env.STAFF_SIGNUP_CODE ?? "",
  );
  const date = facilityDate();
  const runId = uniqueTestId("packaging-run");
  let first: Page | undefined;
  let second: Page | undefined;
  try {
    const account = await fixtures.createAccount({
      password: "FixturePass123!", capabilities: ["manage-profiles"], onboardingSeen: true,
    });
    const startedAt = Date.now() - 180_000;
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 1000, pizzasPerCase: 12, casesPerSkid: 48,
      casesPerLayer: 12, crustsPerCycle: 12, cycleSpeed: 5, approxLineSpeed: 60, speedAdjustment: 1,
      freezerTime: 1, preTunnelMin: 0.1, postTunnelMin: 0.1,
      doughballsPerTray: 36, doughBatchYield: 100, targetDoughballWeight: 8,
      skidsCompleted: 0, casesOnCurrentSkid: 10, traysOnLine: 2, batchesReady: 1,
    };
    await fixtures.seedCanonicalTodaySnapshot({
      token: account.token, date, senderId: uniqueTestId("packaging-sender"),
      payload: {
        dayState: {
          date, currentIndex: 0, resetAt: 0,
          runs: [{ id: runId, brand: "", flavor: "", startedAt, metaUpdatedAt: startedAt, subTab: "dough", seeded: false }],
        },
        runValues: { [runId]: values }, runValuesUpdatedAt: { [runId]: startedAt },
      },
    });
    const viewport = testInfo.project.use.viewport;
    first = await open(browser, account, baseURL!, viewport);
    second = await open(browser, account, baseURL!, viewport);
    const a = first;
    const b = second;
    if (testInfo.project.name === "chromium-desktop") {
      await testInfo.attach("fixture-only-before-packaging-correction", {
        body: await a.screenshot({ type: "png" }),
        contentType: "image/png",
      });
    }
    const correctionResponse = a.waitForResponse((response) =>
      response.url().includes("/sync/manual-section") && response.request().method() === "POST");
    await a.getByTestId("btn-inc-casesOnCurrentSkid").click();
    const correction = await (await correctionResponse).json();
    expect(correction.outcome).toBe("accepted");
    const progress = correction.data.packagingProgress[runId];
    try {
      await expect(b.getByTestId("text-casesOnCurrentSkid")).toHaveText(String(progress.casesOnCurrentSkid), { timeout: 20_000 });
    } catch (error) {
      const canonicalPeer = await canonical(b, date);
      const peerDiagnostics = await b.evaluate((id) => {
        const packaging = JSON.parse(localStorage.getItem("run-calc-packaging-progress") ?? "{}")[id];
        return {
          sse: (window as typeof window & { __packagingSseDiagnostics?: unknown }).__packagingSseDiagnostics,
          packaging: packaging ? {
            count: packaging.casesOnCurrentSkid, generation: packaging.correctionGeneration,
            updatedAt: packaging.updatedAt, manualOverrideUntil: packaging.manualOverrideUntil,
          } : null,
          hidden: document.hidden,
          pendingCommands: Object.keys(localStorage).filter((key) => key.startsWith("run-calculator:manual-section-pending:")).length,
        };
      }, runId);
      console.log("Sanitized peer adoption diagnostic", JSON.stringify({
        ...peerDiagnostics, canonicalCount: canonicalPeer.runValues?.[runId]?.casesOnCurrentSkid,
        canonicalGeneration: canonicalPeer.packagingProgress?.[runId]?.correctionGeneration,
      }));
      throw error;
    }
    await expect(a.getByTestId("btn-resume-now")).toBeEnabled();
    const box = await a.getByTestId("btn-resume-now").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    // Offline Resume cannot claim success, and keeps its exact retry identity.
    await a.context().setOffline(true);
    await a.getByTestId("btn-resume-now").click();
    await expect(a.getByRole("alert").filter({ hasText: "not confirmed" })).toBeVisible();
    const offline = await canonical(b, date);
    expect(offline.packagingProgress[runId].correctionGeneration).toBe(progress.correctionGeneration);
    expect(offline.packagingProgress[runId].manualOverrideUntil).toBe(progress.manualOverrideUntil);
    await a.context().setOffline(false);
    // The outbox may acknowledge its retained request on reconnect. If it does
    // not, this same control explicitly retries that identity, not a correction.
    await expect(a.getByTestId("btn-resume-now")).toBeEnabled({ timeout: 20_000 });
    await a.getByTestId("btn-resume-now").click();
    await expect.poll(async () => (await canonical(b, date)).packagingProgress[runId].manualOverrideUntil, {
      timeout: 20_000,
    }).toBeLessThan(progress.manualOverrideUntil);
    await expect(a.getByTestId("manual-override-banner")).toBeHidden({ timeout: 20_000 });
    const resumed = await canonical(b, date);
    expect(resumed.packagingProgress[runId].correctionGeneration).toBe(progress.correctionGeneration);
    expect(resumed.runValues[runId].casesOnCurrentSkid).toBe(progress.casesOnCurrentSkid);
    const resumeAcknowledgedAt = Date.now();
    try {
      await expect.poll(async () => Number(await b.getByTestId("text-casesOnCurrentSkid").textContent()), {
        // The canonical server worker is scheduled every 15 seconds and this
        // fixture's case cadence is 12 seconds. Stop on the first accepted
        // case; an exact-value poll over 45 seconds can miss it while later
        // valid cadence events advance the running line again.
        timeout: 45_000,
      }).toBeGreaterThan(progress.casesOnCurrentSkid);
    } catch (error) {
      const canonicalAfterTick = await canonical(b, date);
      const peerTickDiagnostics = await b.evaluate((id) => {
        const packaging = JSON.parse(localStorage.getItem("run-calc-packaging-progress") ?? "{}")[id];
        return {
          sse: (window as typeof window & { __packagingSseDiagnostics?: unknown }).__packagingSseDiagnostics,
          packaging: packaging ? {
            count: packaging.casesOnCurrentSkid, generation: packaging.correctionGeneration,
            updatedAt: packaging.updatedAt, manualOverrideUntil: packaging.manualOverrideUntil,
          } : null,
          hidden: document.hidden,
          pendingCommands: Object.keys(localStorage).filter((key) => key.startsWith("run-calculator:manual-section-pending:")).length,
        };
      }, runId);
      console.log("Sanitized post-resume peer tick diagnostic", JSON.stringify({
        ...peerTickDiagnostics,
        canonicalCount: canonicalAfterTick.runValues?.[runId]?.casesOnCurrentSkid,
        canonicalProgress: canonicalAfterTick.packagingProgress?.[runId] ? {
          count: canonicalAfterTick.packagingProgress[runId].casesOnCurrentSkid,
          generation: canonicalAfterTick.packagingProgress[runId].correctionGeneration,
          updatedAt: canonicalAfterTick.packagingProgress[runId].updatedAt,
          manualOverrideUntil: canonicalAfterTick.packagingProgress[runId].manualOverrideUntil,
        } : null,
      }));
      throw error;
    }
    const firstCaseObservedAt = Date.now();
    const firstCaseCount = Number(await b.getByTestId("text-casesOnCurrentSkid").textContent());
    expect(firstCaseCount).toBeGreaterThan(progress.casesOnCurrentSkid);
    expect(firstCaseObservedAt).toBeGreaterThanOrEqual(
      resumed.packagingProgress[runId].manualOverrideUntil + 10_000,
    );
    const firstCaseSnapshot = await canonical(b, date);
    expect(firstCaseSnapshot.runValues[runId].casesOnCurrentSkid).toBe(firstCaseCount);
    expect(firstCaseSnapshot.packagingProgress[runId].correctionGeneration).toBe(progress.correctionGeneration);

    // Pause immediately after that first accepted case. This freezes the
    // canonical count while the peer is reloaded, so later normal case beats
    // cannot turn a valid next-case result into a misleading exact-count fail.
    await a.getByTestId("tab-run").click();
    const pauseButton = a.getByRole("button", { name: "PAUSE RUN" });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    await expect(a.getByTestId("resume-run")).toBeVisible();
    // The optional tunnel-policy prompt may expire and detach its controls
    // while the countdown is open. The actual lifecycle assertion is the
    // canonical paused state, not an interaction with that transient prompt.
    await expect.poll(async () => (await canonical(b, date)).dayState.runs[0]?.pausedAt).toBeTruthy();
    await a.getByTestId("tab-packaging").click();
    await expect.poll(
      async () => Number(await a.getByTestId("text-casesOnCurrentSkid").textContent()),
      { timeout: 10_000 },
    ).toBeGreaterThan(progress.casesOnCurrentSkid);
    const pausedCount = Number(await a.getByTestId("text-casesOnCurrentSkid").textContent());
    await a.reload();
    await a.getByTestId("tab-packaging").click();
    await expect.poll(
      async () => Number(await a.getByTestId("text-casesOnCurrentSkid").textContent()),
    ).toBe(pausedCount);
    const final = await canonical(b, date);
    expect(final.runValues[runId].casesOnCurrentSkid).toBe(progress.casesOnCurrentSkid + 1);
    expect(final.packagingProgress[runId].correctionGeneration).toBe(progress.correctionGeneration);
    await a.getByTestId("tab-run").click();
    await a.getByTestId("resume-run").click();
    await expect(pauseButton).toBeVisible();
    await expect.poll(async () => (await canonical(b, date)).dayState.runs[0]?.pausedAt).toBeFalsy();
    if (testInfo.project.name === "chromium-desktop") {
      await a.getByTestId("tab-packaging").click();
      await expect(a.getByTestId("text-casesOnCurrentSkid")).toHaveText(String(progress.casesOnCurrentSkid + 1));
      await testInfo.attach("fixture-only-after-recovery-reload", {
        body: await a.screenshot({ type: "png" }),
        contentType: "image/png",
      });
      await testInfo.attach("sanitized-browser-issue-counts", {
        body: JSON.stringify({
          project: testInfo.project.name,
          first: browserIssueCounts.get(a) ?? { consoleErrors: 0, pageErrors: 0 },
          peer: browserIssueCounts.get(b) ?? { consoleErrors: 0, pageErrors: 0 },
        }),
        contentType: "application/json",
      });
    }
    await testInfo.attach("sanitized-result", {
      body: JSON.stringify({ project: testInfo.project.name, correction: "accepted", resume: "acknowledged", peer: "advanced-once", reload: "converged" }),
      contentType: "application/json",
    });
  } finally {
    await first?.context().close();
    await second?.context().close();
    await fixtures.cleanup();
  }
});
