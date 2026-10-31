import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { DEFAULT_VALUES } from "../src/types";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";
import {
  capturedManualRequest,
  installManualFetchGate,
  releaseAndCaptureManualFetchGate,
  reconnectAtSessionBoundary,
  releaseManualFetchGate,
  type ManualFetchGateResult,
} from "./operationalRecoveryFixtures";
import {
  requireLiveAuthorityEvidenceId,
  selectLiveAuthorityContinuationCase,
} from "./liveAuthorityContinuationPlan";

const PASSWORD = "FixturePass123!";
const usernames = new Set<string>();
const ACTION_TIMEOUT = 8_000;
const API_TIMEOUT = 10_000;
const selectedContinuation = process.env.LIVE_AUTHORITY_CASE
  ? selectLiveAuthorityContinuationCase(process.env.LIVE_AUTHORITY_CASE)
  : undefined;
const OFFLINE_NOTICE =
  /Your (?:local change is retained on this device\. It is not shared until the server acknowledges it|latest changes are retained on this device, but the server has not acknowledged them)/i;

function nanoid(size = 18): string {
  const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_G5";
  const bytes = randomBytes(size);
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join("");
}

function facilityDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

type FixturePage = { context: BrowserContext; page: Page; userId: string };
type Canonical = {
  canonicalRevision?: number;
  dayState: { runs: Array<Record<string, unknown>>; currentIndex: number };
  runValues: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};
type ManualPending = {
  id: string;
  owner: string;
  runId: string;
  section: string;
  values: Record<string, number>;
  baseValues: Record<string, number>;
  deliveryState?: string;
};

async function register(
  browser: Browser,
  baseURL: string,
  username: string,
  viewport: { width: number; height: number },
): Promise<FixturePage> {
  const context = await browser.newContext({ baseURL, viewport, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: process.env.STAFF_SIGNUP_CODE ?? "",
  });
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Synthetic fixture identity was not available");
    return await response.json() as { userId?: string };
  });
  if (!identity.userId) throw new Error("Synthetic fixture identity was incomplete");
  return { context, page, userId: identity.userId };
}

async function promoteManager(page: FixturePage): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("continuation synthetic manager fixture"),
  });
  try {
    await db.connect();
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [page.userId],
    );
    await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [page.userId]);
  } finally {
    await db.end().catch(() => {});
  }
  await page.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 });
  await page.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 12_000 });
}

async function canonical(page: Page, date: string): Promise<Canonical> {
  const response = await page.request.get(`/api/sync/today?today=${date}`, {
    headers: { "cache-control": "no-cache" },
    timeout: API_TIMEOUT,
  });
  if (!response.ok()) throw new Error(`Canonical read returned HTTP ${response.status()}`);
  return await response.json() as Canonical;
}

async function seedPendingRuns(
  pages: Page[],
  date: string,
  runIds: [string, string],
): Promise<number> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("continuation live-state fixture"),
  });
  const at = Date.now() - 2_000;
  const values = {
    ...DEFAULT_VALUES,
    casesNeeded: 500,
    crustsPerCycle: 1,
    cycleSpeed: 60,
    approxLineSpeed: 60,
    freezerTime: 5,
    pizzasPerCase: 1,
    casesPerSkid: 10,
    casesPerLayer: 10,
    doughballsPerTray: 6,
    doughBatchYield: 4,
    targetDoughballWeight: 8,
    traysOnLine: 2,
    batchesReady: 0,
    casesOnCurrentSkid: 0,
    preTunnelMin: 0.2,
    pressOvenMin: 0.2,
    frontlineMin: 0.2,
    postTunnelMin: 0.2,
  };
  const payload = {
    syncVersion: 1,
    completeness: "complete",
    dayState: {
      date,
      currentIndex: 0,
      resetAt: 0,
      runs: runIds.map((id, index) => ({
        id,
        brand: "Synthetic Continuation",
        flavor: index === 0 ? "Primary" : "Selection",
        subTab: "dough",
        seeded: false,
        ...(index === 0 ? { startedAt: at } : {}),
        autoTrackDisabled: true,
        metaUpdatedAt: at,
      })),
    },
    runValues: {
      [runIds[0]]: values,
      [runIds[1]]: { ...values, casesNeeded: 220 },
    },
    runValuesUpdatedAt: { [runIds[0]]: at, [runIds[1]]: at },
  };
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [date]);
    await db.query(
      "INSERT INTO daily_sync (date, scope, data, canonical_revision) VALUES ($1, 'live', $2::jsonb, 0)",
      [date, JSON.stringify(payload)],
    );
  } finally {
    await db.end().catch(() => {});
  }
  for (const page of pages) {
    await page.evaluate(({ fixtureDate, ids, configured, stamp }) => {
      localStorage.setItem("run-calc-day", JSON.stringify({
        date: fixtureDate,
        currentIndex: 0,
        resetAt: 0,
        runs: ids.map((id, index) => ({
          id,
          brand: "Synthetic Continuation",
          flavor: index === 0 ? "Primary" : "Selection",
          subTab: "dough",
          seeded: false,
          ...(index === 0 ? { startedAt: stamp } : {}),
          autoTrackDisabled: true,
          metaUpdatedAt: stamp,
        })),
      }));
      localStorage.setItem(`run-calc-run-${ids[0]}`, JSON.stringify(configured[0]));
      localStorage.setItem(`run-calc-run-${ids[1]}`, JSON.stringify(configured[1]));
    }, {
      fixtureDate: date,
      ids: runIds,
      configured: [values, { ...values, casesNeeded: 220 }],
      stamp: at,
    });
  }
  return at;
}

function manualResponse(
  response: Response,
  expected: { id?: string; runId?: string; section?: string } = {},
): boolean {
  if (new URL(response.url()).pathname !== "/api/sync/manual-section"
    || response.request().method() !== "POST") return false;
  try {
    const body = response.request().postDataJSON() as {
      id?: string; runId?: string; section?: string;
    } | null;
    return (!expected.id || body?.id === expected.id)
      && (!expected.runId || body?.runId === expected.runId)
      && (!expected.section || body?.section === expected.section);
  } catch {
    return false;
  }
}

function isManualRequest(request: Request): boolean {
  return new URL(request.url()).pathname === "/api/sync/manual-section"
    && request.method() === "POST";
}

function intentResponse(
  response: Response,
  action: string,
  lifecycle: string | undefined,
  runId: string,
): boolean {
  if (new URL(response.url()).pathname !== "/api/sync/operational-intents"
    || response.request().method() !== "POST") return false;
  try {
    const body = response.request().postDataJSON() as {
      intent?: { action?: string; lifecycle?: string; runId?: string };
    } | null;
    return body?.intent?.action === action
      && body.intent.lifecycle === lifecycle
      && body.intent.runId === runId;
  } catch {
    return false;
  }
}

async function manualClick(
  page: Page,
  testId: string,
  runId: string,
  section: string,
): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => manualResponse(candidate, { runId, section }),
      { timeout: API_TIMEOUT },
    ),
    page.getByTestId(testId).click({ timeout: ACTION_TIMEOUT }),
  ]);
  return response;
}

async function readPendingManual(
  page: Page,
  ownerId: string,
  runId: string,
  section: string,
  scope: "live" | "sandbox" = "live",
): Promise<ManualPending | null> {
  return await page.evaluate(({ owner, targetRun, targetSection }) => {
    const prefix = `run-calculator:manual-section-pending:v1:${owner}:`;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key) ?? "null");
        if (record?.runId === targetRun && record?.section === targetSection) {
          return {
            id: String(record.id ?? ""),
            owner: String(record.owner ?? ""),
            runId: String(record.runId ?? ""),
            section: String(record.section ?? ""),
            values: record.values ?? {},
            baseValues: record.baseValues ?? {},
            deliveryState: typeof record.deliveryState === "string" ? record.deliveryState : undefined,
          };
        }
      } catch {}
    }
    return null;
  }, { owner: `${scope}:${ownerId}`, targetRun: runId, targetSection: section });
}

async function close(fixture?: FixturePage): Promise<void> {
  await fixture?.context.close().catch(() => {});
}

async function signOutThroughUI(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More(?:\s|$)/ }).click({ timeout: ACTION_TIMEOUT });
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/auth/sign-out"
        && candidate.request().method() === "POST", { timeout: API_TIMEOUT }),
    page.getByRole("menuitem", { name: "Sign out", exact: true })
      .click({ timeout: ACTION_TIMEOUT }),
  ]);
  expect(response.status(), "Sign out must revoke the server session").toBe(204);
  await expect(page.getByRole("heading", { name: "Production Run Calculator", exact: true }))
    .toBeVisible({ timeout: ACTION_TIMEOUT });
  // Signed-out App renders Landing, not the form. Open its public sign-in
  // control rather than bypassing the real transition with an injected session.
  await page.getByRole("button", { name: "Sign in", exact: true }).click({ timeout: ACTION_TIMEOUT });
  await page.getByTestId("auth-screen").waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
  await page.getByRole("heading", { name: "Sign in to Run Calculator" })
    .waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
}

async function closeSyncStatusPopover(page: Page): Promise<void> {
  const toggle = page.getByTestId("sync-status-button");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click({ timeout: ACTION_TIMEOUT });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Saved manual corrections", { exact: true })).toHaveCount(0);
}

function safeManualFetchDiagnostic(purpose: string, result: ManualFetchGateResult) {
  const body = result.response?.json;
  const safeJson: Record<string, string> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    for (const key of ["code", "outcome"] as const) {
      if (typeof record[key] === "string") safeJson[key] = record[key];
    }
  }
  return {
    purpose,
    request: result.request,
    ...(result.response ? {
      response: {
        status: result.response.status,
        ok: result.response.ok,
        path: result.response.path,
        ...(Object.keys(safeJson).length > 0 ? { json: safeJson } : {}),
        ...(result.response.jsonReadError ? { jsonReadError: result.response.jsonReadError } : {}),
      },
    } : {}),
    ...(result.transportError ? { transportError: result.transportError } : {}),
  };
}

test.afterAll(async () => {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("continuation fixture cleanup"),
  });
  try {
    await db.connect();
    await cleanupTestUsers(db, usernames);
    await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope IN ('live', 'sandbox')", [facilityDate()]);
  } finally {
    await db.end().catch(() => {});
  }
});

// This standalone continuation is opt-in. Ordinary suite discovery must not
// fail or silently rerun these flows without their dedicated case selection.
if (selectedContinuation) {
const { name: remainingCase, plan: casePlan } = selectedContinuation;
const evidenceId = requireLiveAuthorityEvidenceId(process.env.LIVE_AUTHORITY_EVIDENCE_ID);
test(`${remainingCase}: continue only the selected remaining browser flow`, async ({
  browser,
  baseURL,
}, testInfo) => {
  const projectName = testInfo.project.name;
  const viewport = testInfo.project.use.viewport as { width: number; height: number };
  const date = facilityDate();
  const runIds: [string, string] = [
    uniqueTestId("continuation-primary"),
    uniqueTestId("continuation-selection"),
  ];
  const stages: string[] = [];
  const manualFetchDiagnostics: Array<ReturnType<typeof safeManualFetchDiagnostic>> = [];
  const mark = (stage: string) => {
    stages.push(stage);
    console.info(`[LIVE_AUTHORITY_CONTINUATION] ${evidenceId} ${projectName} ${stage}`);
  };
  let a: FixturePage | undefined;
  let b: FixturePage | undefined;
  let gatedPage: Page | undefined;

  try {
    expect(projectName, "the selected case must run only its declared Playwright project")
      .toBe(casePlan.project);
    const aName = `live_cont_mgr_${nanoid()}`;
    const bName = `live_cont_peer_${nanoid()}`;
    usernames.add(aName);
    usernames.add(bName);
    a = await register(browser, baseURL!, aName, viewport);
    b = await register(browser, baseURL!, bName, viewport);
    await Promise.all([promoteManager(a), promoteManager(b)]);
    await seedPendingRuns([a.page, b.page], date, runIds);
    await Promise.all([
      a.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 }),
      b.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 }),
    ]);
    await Promise.all([
      a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 12_000 }),
      b.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 12_000 }),
    ]);
    mark("fixture.loaded");

    await b.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 });
    await b.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 12_000 });
    await expect(b.page.getByTestId("input-casesNeeded")).toHaveValue("500");
    const seededRunning = await canonical(a.page, date);
    expect(seededRunning.dayState.runs[0]?.startedAt, "fixture starts from canonical running state").toBeTruthy();
    mark("fixture.running-from-isolated-canonical-seed");

    // Only WebKit tablet projects that never started in the stopped batch still
    // run this held-response/run-switch case. The already-reached WebKit desktop
    // and phone cases are deliberately not repeated.
    if (casePlan.webkitHeldResponse) {
      await b.page.getByTestId("tab-packaging").click({ timeout: ACTION_TIMEOUT });
      await installManualFetchGate(b.page);
      gatedPage = b.page;
      await b.page.getByTestId("btn-inc-casesOnCurrentSkid").click({ timeout: ACTION_TIMEOUT });
      const held = await capturedManualRequest(b.page);
      expect(held.path).toBe("/api/sync/manual-section");
      expect(held.method).toBe("POST");
      expect(held.body.runId).toBe(runIds[0]);
      expect(held.body.section).toBe("packaging");
      expect(held.body.values.casesOnCurrentSkid).toBe(1);
      expect(held.body.baseValues.casesOnCurrentSkid).toBe(0);
      mark("webkit.manual-request-held-before-transport");

      await a.page.getByTestId("tab-packaging").click({ timeout: ACTION_TIMEOUT });
      for (let count = 0; count < 2; count++) {
        const response = await manualClick(
          a.page, "btn-inc-casesOnCurrentSkid", runIds[0], "packaging",
        );
        expect(response.status(), "current A Packaging correction is acknowledged").toBe(200);
        expect((await response.json() as { outcome?: string }).outcome).toBe("accepted");
      }
      const competing = await canonical(a.page, date);
      expect(competing.runValues[runIds[0]]?.casesOnCurrentSkid).toBe(2);
      await b.page.getByTestId("tab-run").click({ timeout: ACTION_TIMEOUT });
      await b.page.getByRole("button", { name: "Select run 2" }).click({ timeout: ACTION_TIMEOUT });
      await expect(b.page.getByTestId("input-casesNeeded")).toHaveValue("220");
      const heldResult = await releaseAndCaptureManualFetchGate(b.page);
      gatedPage = undefined;
      manualFetchDiagnostics.push(safeManualFetchDiagnostic("webkit-held-packaging-conflict", heldResult));
      console.info(`[LIVE_AUTHORITY_FETCH_GATE] ${evidenceId} ${projectName} ${JSON.stringify(manualFetchDiagnostics.at(-1))}`);
      expect(heldResult.request).toMatchObject({
        id: held.body.id,
        runId: runIds[0],
        section: "packaging",
        method: "POST",
        path: "/api/sync/manual-section",
      });
      expect(heldResult.transportError).toBeUndefined();
      expect(heldResult.response?.status).toBe(409);
      expect((heldResult.response?.json as { code?: string } | undefined)?.code)
        .toBe("section_changed");
      const selectedRun = await canonical(b.page, date);
      expect(selectedRun.runValues[runIds[0]]?.casesOnCurrentSkid).toBe(2);
      await expect(b.page.getByTestId("input-casesNeeded")).toHaveValue("220");
      const retained = await readPendingManual(b.page, b.userId, runIds[0], "packaging");
      expect(retained).toMatchObject({
        owner: `live:${b.userId}`,
        runId: runIds[0],
        section: "packaging",
        values: { casesOnCurrentSkid: 1 },
        deliveryState: "rejected",
      });
      await b.page.getByTestId("sync-status-button").click({ timeout: ACTION_TIMEOUT });
      await expect(b.page.getByText(/Saved manual corrections|Review required/i).first())
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      await closeSyncStatusPopover(b.page);
      mark("webkit.manual-409-run-switch-owner-review");
    }

    let ownerRequestId: string | undefined;
    if (casePlan.desktopScope) {
      // Desktop recovery was already proven. Create only the rejected owner
      // record needed for the remaining account/scope journey: hold A's real
      // online Dough request, let B commit the same section to 4, then deliver
      // A's exact 2 -> 3 request and retain its real 409 for review.
      await Promise.all([
        a.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT }),
        b.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT }),
      ]);
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("2");
      await expect(b.page.getByTestId("input-traysOnLine")).toHaveValue("2");
      await installManualFetchGate(a.page);
      gatedPage = a.page;
      await a.page.getByTestId("btn-inc-traysOnLine").click({ timeout: ACTION_TIMEOUT });
      const held = await capturedManualRequest(a.page);
      expect(held.path).toBe("/api/sync/manual-section");
      expect(held.method).toBe("POST");
      expect(held.body.runId).toBe(runIds[0]);
      expect(held.body.section).toBe("dough");
      expect(held.body.values.traysOnLine).toBe(3);
      expect(held.body.baseValues.traysOnLine).toBe(2);
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("3");
      const beforeTransport = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(beforeTransport).toMatchObject({
        id: held.body.id,
        owner: `live:${a.userId}`,
        runId: runIds[0],
        section: "dough",
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
      });
      ownerRequestId = held.body.id;
      mark("desktop-real-owner-request-held-before-transport");

      for (let count = 0; count < 2; count++) {
        const peerReceipt = await manualClick(b.page, "btn-inc-traysOnLine", runIds[0], "dough");
        expect(peerReceipt.status(), "peer Dough correction has a real accepted receipt").toBe(200);
        expect((await peerReceipt.json() as { outcome?: string }).outcome).toBe("accepted");
      }
      expect((await canonical(b.page, date)).runValues[runIds[0]]?.traysOnLine).toBe(4);
      mark("desktop-peer-dough-canonical-four");

      const rejectedResult = await releaseAndCaptureManualFetchGate(a.page);
      gatedPage = undefined;
      manualFetchDiagnostics.push(safeManualFetchDiagnostic("desktop-held-dough-conflict", rejectedResult));
      console.info(`[LIVE_AUTHORITY_FETCH_GATE] ${evidenceId} ${projectName} ${JSON.stringify(manualFetchDiagnostics.at(-1))}`);
      expect(rejectedResult.request).toMatchObject({
        id: ownerRequestId,
        runId: runIds[0],
        section: "dough",
        method: "POST",
        path: "/api/sync/manual-section",
      });
      expect(rejectedResult.transportError).toBeUndefined();
      expect(rejectedResult.response?.status).toBe(409);
      expect((rejectedResult.response?.json as { code?: string } | undefined)?.code)
        .toBe("section_changed");
      const canonicalFour = await canonical(a.page, date);
      expect(canonicalFour.runValues[runIds[0]]?.traysOnLine).toBe(4);
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("4");
      const ownerPreserved = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(ownerPreserved).toMatchObject({
        id: ownerRequestId,
        owner: `live:${a.userId}`,
        runId: runIds[0],
        section: "dough",
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
        deliveryState: "rejected",
      });
      await a.page.getByTestId("sync-status-button").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByText(/Saved manual corrections|Review required/i).first())
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      await closeSyncStatusPopover(a.page);
      mark("desktop-owner-request-review-ready-without-offline-replay");
    } else if (casePlan.offlineManualRecovery) {
      // Repeat only projects whose manual-recovery segment failed or was not
      // reached. Already-green phone/tablet/WebKit manual recovery is omitted.
      await a.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT });
      await b.page.getByRole("button", { name: "Select run 1" }).click({ timeout: ACTION_TIMEOUT });
      await b.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("2");
      const serviceWorkerControlled = await a.page.evaluate(
        () => Boolean(navigator.serviceWorker?.controller),
      );
      expect(serviceWorkerControlled, "offline reload requires the installed application worker")
        .toBe(true);
      await a.context.setOffline(true);
      await a.page.getByTestId("btn-inc-traysOnLine").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("3");
      const beforeReloadPending = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(beforeReloadPending).toMatchObject({
        owner: `live:${a.userId}`,
        runId: runIds[0],
        section: "dough",
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
      });
      ownerRequestId = beforeReloadPending!.id;
      mark("offline-manual-owner-request-retained");

      await a.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 });
      await expect(a.page.getByText(
        "We couldn't confirm your staff session. Check the connection and try again.",
        { exact: true },
      )).toBeVisible({ timeout: 12_000 });
      await expect(a.page.getByTestId("tab-run")).toHaveCount(0);
      const afterReloadPending = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(afterReloadPending?.id).toBe(ownerRequestId);
      expect(afterReloadPending?.owner).toBe(`live:${a.userId}`);
      expect(afterReloadPending?.values.traysOnLine).toBe(3);
      expect(afterReloadPending?.baseValues.traysOnLine).toBe(2);
      mark("offline-manual-survives-unverified-session-reload");

      const firstPeerCorrection = await manualClick(
        b.page, "btn-inc-traysOnLine", runIds[0], "dough",
      );
      expect(firstPeerCorrection.status()).toBe(200);
      expect((await firstPeerCorrection.json() as { outcome?: string }).outcome).toBe("accepted");
      const secondPeerCorrection = await manualClick(
        b.page, "btn-inc-traysOnLine", runIds[0], "dough",
      );
      expect(secondPeerCorrection.status()).toBe(200);
      expect((await secondPeerCorrection.json() as { outcome?: string }).outcome).toBe("accepted");
      expect((await canonical(b.page, date)).runValues[runIds[0]]?.traysOnLine).toBe(4);
      mark("peer-canonical-counter-advanced");

      const offlineManualReplay = a.page.waitForResponse(
        (response) => manualResponse(response, { id: ownerRequestId }),
        { timeout: API_TIMEOUT },
      );
      await reconnectAtSessionBoundary(a);
      const offlineManualResponse = await offlineManualReplay;
      expect(offlineManualResponse.status(), "stale offline manual correction receives explicit conflict")
        .toBe(409);
      const adopted = await canonical(a.page, date);
      expect(adopted.runValues[runIds[0]]?.traysOnLine).toBe(4);
      await a.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("4");
      const ownerPreserved = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(ownerPreserved).toMatchObject({
        id: ownerRequestId,
        owner: `live:${a.userId}`,
        runId: runIds[0],
        section: "dough",
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
        deliveryState: "rejected",
      });
      mark("canonical-adopted-before-next-action");
      await a.page.getByTestId("sync-status-button").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByText(/Saved manual corrections|Review required/i).first())
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      await closeSyncStatusPopover(a.page);
      mark("offline-manual-conflict-review-visible");
    }

    // Only the desktop scope/end segment performs an account transition. The
    // public sandbox entry must not replay the retained Live correction under
    // the sandbox cookie; signing back in must recover its original owner.
    if (casePlan.desktopScope) {
      const liveOwnerRequestId = ownerRequestId!;
      let sandboxActive = false;
      let liveRequestDeliveredInSandbox = false;
      const sandboxResetResponses: Response[] = [];
      let sandboxReloadsAfterReset = 0;
      const captureSandboxReload = (frame: import("@playwright/test").Frame) => {
        if (frame === a!.page.mainFrame() && sandboxResetResponses.length > 0) {
          sandboxReloadsAfterReset++;
        }
      };
      const captureSandboxReset = (response: Response) => {
        if (new URL(response.url()).pathname === "/api/sandbox/reset"
          && response.request().method() === "POST") sandboxResetResponses.push(response);
      };
      a.page.on("request", (request) => {
        if (!sandboxActive || !isManualRequest(request)) return;
        try {
          const body = request.postDataJSON() as { id?: string } | null;
          if (body?.id === liveOwnerRequestId) liveRequestDeliveredInSandbox = true;
        } catch {}
      });
      const liveBeforeSandbox = await canonical(a.page, date);
      expect(liveBeforeSandbox.runValues[runIds[0]]?.traysOnLine).toBe(4);
      await signOutThroughUI(a.page);
      a.page.on("response", captureSandboxReset);
      a.page.on("framenavigated", captureSandboxReload);
      sandboxActive = true;
      const sandboxSignInPromise = a.page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== "/api/auth/sign-in"
          || response.request().method() !== "POST") return false;
        try {
          return (response.request().postDataJSON() as { username?: string } | null)?.username === "test";
        } catch {
          return false;
        }
      }, { timeout: API_TIMEOUT });
      const [sandboxSignIn] = await Promise.all([
        sandboxSignInPromise,
        a.page.getByRole("button", { name: "Log in as test user (sandbox)", exact: true })
          .click({ timeout: ACTION_TIMEOUT }),
      ]);
      expect(sandboxSignIn.status(), "public sandbox entry uses the real sign-in endpoint").toBe(200);
      const sandboxSignInBody = await sandboxSignIn.json() as {
        user?: { userId?: string; sandbox?: boolean; sandboxStale?: boolean };
      };
      expect(sandboxSignInBody.user?.sandbox).toBe(true);
      expect(sandboxSignInBody.user?.userId).toBeTruthy();
      await a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 15_000 });
      if (sandboxSignInBody.user?.sandboxStale) {
        await expect.poll(() => sandboxResetResponses.length, {
          timeout: API_TIMEOUT,
          message: "stale sandbox seed must be copied by the existing server reset flow",
        }).toBeGreaterThan(0);
        expect(sandboxResetResponses.at(-1)?.status()).toBe(200);
        // Home deliberately reloads after the supported stale sandbox reset.
        // A pre-reload mounted tab is not a settled authenticated destination.
        await expect.poll(() => sandboxReloadsAfterReset, {
          timeout: API_TIMEOUT,
          message: "supported sandbox reset reload must commit before probing identity",
        }).toBeGreaterThan(0);
        await a.page.waitForLoadState("domcontentloaded");
        await a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 15_000 });
      }
      a.page.off("framenavigated", captureSandboxReload);
      const sandboxMe = await a.page.request.get("/api/me", { timeout: API_TIMEOUT });
      expect(sandboxMe.status(), "shared browser cookie must authenticate the sandbox identity").toBe(200);
      const sandboxIdentity = await sandboxMe.json() as { userId?: string; sandbox?: boolean };
      expect(sandboxIdentity.sandbox, "public sandbox entry must establish sandbox scope").toBe(true);
      expect(sandboxIdentity.userId).toBeTruthy();
      expect(sandboxIdentity.userId).not.toBe(a.userId);
      // The public demo account has its own first-login acknowledgment.
      // Complete it through the existing real UI/server helper, not storage.
      await dismissOnboardingIfPresent(a.page);
      const sandboxState = await canonical(a.page, date);
      if (sandboxSignInBody.user?.sandboxStale) {
        // The supported sandbox policy explicitly copies live server records
        // into sandbox on a stale/first login. Matching IDs/names here are
        // expected seed data, not browser adoption across accounts.
        const copiedRun = sandboxState.dayState.runs.find((run) => run.id === runIds[0]);
        expect(copiedRun).toMatchObject({
          id: runIds[0],
          brand: "Synthetic Continuation",
          flavor: "Primary",
        });
        expect(sandboxState.runValues[runIds[0]]?.traysOnLine)
          .toBe(liveBeforeSandbox.runValues[runIds[0]]?.traysOnLine);
        expect(sandboxState.runValues[runIds[0]]?.traysOnLine).toBe(4);
      }
      const sandboxOwnerRequest = await readPendingManual(
        a.page, sandboxIdentity.userId!, runIds[0], "dough", "sandbox",
      );
      expect(sandboxOwnerRequest, "sandbox must not adopt the Live owner's local recovery").toBeNull();
      const stillLiveOwnerRequest = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(stillLiveOwnerRequest).toMatchObject({
        id: liveOwnerRequestId,
        owner: `live:${a.userId}`,
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
        deliveryState: "rejected",
      });
      await a.page.getByTestId("sync-status-button").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByText("Saved manual corrections", { exact: true })).toHaveCount(0);
      await expect(a.page.getByText("Review required", { exact: true })).toHaveCount(0);
      await closeSyncStatusPopover(a.page);
      expect(liveRequestDeliveredInSandbox, "Live manual request must not be delivered in sandbox scope")
        .toBe(false);
      a.page.off("response", captureSandboxReset);
      mark("sandbox-public-entry-no-live-recovery-or-delivery");

      sandboxActive = false;
      await signOutThroughUI(a.page);
      await a.page.getByLabel("Username", { exact: true }).fill(aName);
      await a.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      const liveSignInPromise = a.page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== "/api/auth/sign-in"
          || response.request().method() !== "POST") return false;
        try {
          return (response.request().postDataJSON() as { username?: string } | null)?.username === aName;
        } catch {
          return false;
        }
      }, { timeout: API_TIMEOUT });
      const [liveSignIn] = await Promise.all([
        liveSignInPromise,
        a.page.getByRole("button", { name: "Sign in", exact: true })
          .click({ timeout: ACTION_TIMEOUT }),
      ]);
      expect(liveSignIn.status(), "the original Live account is restored through real sign-in").toBe(200);
      const liveSignInBody = await liveSignIn.json() as {
        user?: { userId?: string; sandbox?: boolean };
      };
      expect(liveSignInBody.user).toMatchObject({ userId: a.userId, sandbox: false });
      await a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 15_000 });
      const restoredLive = await canonical(a.page, date);
      expect(restoredLive.dayState.runs.some((run) => run.id === runIds[0])).toBe(true);
      expect(restoredLive.runValues[runIds[0]]?.traysOnLine).toBe(4);
      expect(restoredLive.runValues[runIds[0]]?.traysOnLine)
        .toBe(liveBeforeSandbox.runValues[runIds[0]]?.traysOnLine);
      const restoredOwnerRequest = await readPendingManual(a.page, a.userId, runIds[0], "dough");
      expect(restoredOwnerRequest).toMatchObject({
        id: liveOwnerRequestId,
        owner: `live:${a.userId}`,
        values: { traysOnLine: 3 },
        baseValues: { traysOnLine: 2 },
        deliveryState: "rejected",
      });
      await a.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("4");
      await a.page.getByTestId("sync-status-button").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByText(/Saved manual corrections|Review required/i).first())
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      await closeSyncStatusPopover(a.page);
      mark("live-owner-request-and-canonical-restored-after-sandbox");
    }

    // Run offline lifecycle only for the selected phone/WebKit segments that
    // did not complete it before the stopped batch.
    if (casePlan.offlineLifecycle) {
      await a.page.getByTestId("tab-run").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByRole("button", { name: /PAUSE RUN/i })).toBeVisible();
      await a.context.setOffline(true);
      await a.page.getByRole("button", { name: /PAUSE RUN/i }).click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("resume-run")).toBeVisible({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("operational-state-badge"))
        .toHaveText("Offline — local projection", { timeout: ACTION_TIMEOUT });
      await a.page.getByRole("button", { name: "Keep safe stop-tunnel default", exact: true })
        .click({ timeout: ACTION_TIMEOUT });
      await a.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 });
      await expect(a.page.getByText(
        "We couldn't confirm your staff session. Check the connection and try again.",
        { exact: true },
      )).toBeVisible({ timeout: 12_000 });
      expect(await a.page.evaluate(({ owner, runId }) =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("run-calculator:operational-intent-outbox:v1:pending:"))
          .some((key) => {
            try {
              const item = JSON.parse(localStorage.getItem(key) ?? "null");
              return item?.owner === owner && item.runId === runId
                && item.action === "pause";
            } catch { return false; }
          }), { owner: `live:${a.userId}`, runId: runIds[0] })).toBe(true);
      expect((await canonical(b.page, date)).dayState.runs[0]?.pausedAt).toBeFalsy();

      const offlinePauseResponse = a.page.waitForResponse(
        (response) => intentResponse(response, "pause", undefined, runIds[0]),
        { timeout: API_TIMEOUT },
      );
      await reconnectAtSessionBoundary(a);
      const pauseReceipt = await offlinePauseResponse;
      expect(pauseReceipt.status()).toBe(200);
      const pauseBody = await pauseReceipt.json() as { outcome?: string };
      expect(["accepted", "rebased"]).toContain(pauseBody.outcome);
      await expect.poll(async () => (await canonical(b.page, date)).dayState.runs[0]?.pausedAt, {
        timeout: ACTION_TIMEOUT,
      }).toBeTruthy();

      const resumeReceiptPromise = a.page.waitForResponse(
        (response) => intentResponse(response, "resume", undefined, runIds[0]),
        { timeout: API_TIMEOUT },
      );
      await a.page.getByTestId("resume-run").click({ timeout: ACTION_TIMEOUT });
      const resumeReceipt = await resumeReceiptPromise;
      expect(resumeReceipt.status()).toBe(200);
      const resumeBody = await resumeReceipt.json() as { outcome?: string };
      expect(["accepted", "rebased"]).toContain(resumeBody.outcome);
      await expect.poll(async () => (await canonical(a.page, date)).dayState.runs[0]?.pausedAt, {
        timeout: ACTION_TIMEOUT,
      }).toBeFalsy();
      mark("phone-webkit-offline-pause-reconnect-resume");
    }

    if (casePlan.verifyEndSummary) {
      await a.page.getByTestId("tab-dough").click({ timeout: ACTION_TIMEOUT });
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("2");
      const correctionReceipt = await manualClick(
        a.page, "btn-inc-traysOnLine", runIds[0], "dough",
      );
      expect(correctionReceipt.status(), "the manual Dough correction is acknowledged").toBe(200);
      expect((await correctionReceipt.json() as { outcome?: string }).outcome).toBe("accepted");
      await expect(a.page.getByTestId("input-traysOnLine")).toHaveValue("3");
      expect((await canonical(a.page, date)).runValues[runIds[0]]?.traysOnLine)
        .toBe(3);
      mark("manual-dough-correction-canonical-before-end");
    }

    // End only while the canonical run is running. No swallowed click and no
    // optional confirmation: require the UI action, server receipt, an explicit
    // zero-surplus receipt, and the prior-run freezer drain.
    await a.page.getByTestId("tab-run").click({ timeout: ACTION_TIMEOUT });
    await a.page.getByRole("button", { name: "Select run 1" }).click({ timeout: ACTION_TIMEOUT });
    await expect(a.page.getByTestId("input-casesNeeded")).toHaveValue("500");
    const beforeEnd = await canonical(a.page, date);
    expect(beforeEnd.dayState.runs[0]?.startedAt).toBeTruthy();
    expect(beforeEnd.dayState.runs[0]?.pausedAt).toBeFalsy();
    expect(beforeEnd.dayState.runs[0]?.endedAt).toBeFalsy();
    const stopButton = a.page.getByRole("button", { name: /STOP RUN/i });
    await expect(stopButton).toBeVisible({ timeout: ACTION_TIMEOUT });
    const endReceiptPromise = a.page.waitForResponse(
      (response) => intentResponse(response, "lifecycle", "end", runIds[0]),
      { timeout: API_TIMEOUT },
    );
    await stopButton.click({ timeout: ACTION_TIMEOUT });
    const endReceipt = await endReceiptPromise;
    expect(endReceipt.status(), "Stop Run must receive a server acknowledgment").toBe(200);
    const endBody = await endReceipt.json() as { outcome?: string; data?: Canonical };
    const receiptRun = endBody.data?.dayState.runs.find((run) => run.id === runIds[0]);
    const requestedEnd = endReceipt.request().postDataJSON() as {
      intent?: { id?: string; observedGeneration?: string; baseRevision?: number; effectiveAt?: number };
    };
    console.info("[LIVE_AUTHORITY_END_RECEIPT]", JSON.stringify({
      project: projectName,
      evidenceId,
      outcome: endBody.outcome,
      request: requestedEnd.intent && {
        id: requestedEnd.intent.id,
        observedGeneration: requestedEnd.intent.observedGeneration,
        baseRevision: requestedEnd.intent.baseRevision,
        effectiveAt: requestedEnd.intent.effectiveAt,
      },
      beforeRevision: beforeEnd.canonicalRevision,
      canonicalRevision: endBody.data?.canonicalRevision,
      canonical: receiptRun && {
        id: receiptRun.id,
        startedAt: receiptRun.startedAt,
        pausedAt: receiptRun.pausedAt,
        endedAt: receiptRun.endedAt,
        metaUpdatedAt: (receiptRun as unknown as { metaUpdatedAt?: number }).metaUpdatedAt,
      },
    }));
    expect(endBody.outcome).toBe("accepted");
    expect(receiptRun?.endedAt).toBeTruthy();
    await expect(a.page.getByTestId("input-casesNeeded")).toHaveValue("220");
    mark("stop-run-canonical-end-receipt");

    await expect.poll(async () => {
      const state = await canonical(a!.page, date);
      return state.dayState.runs.find((run) => run.id === runIds[0])?.endedAt;
    }, { timeout: ACTION_TIMEOUT }).toBeTruthy();
    const ended = await canonical(a.page, date);
    const endedRun = ended.dayState.runs.find((run) => run.id === runIds[0]);
    expect(endedRun?.endedAt).toBe(receiptRun?.endedAt);
    expect(endedRun?.pausedAt).toBeFalsy();
    const endedValues = ended.runValues[runIds[0]] ?? {};
    const casesDone = Number(endedValues.skidsCompleted ?? 0) * Number(endedValues.casesPerSkid ?? 0)
      + Number(endedValues.casesOnCurrentSkid ?? 0);
    const casesNeeded = Number(endedValues.casesNeeded ?? 0);
    await a.page.getByTestId("tab-packaging").click({ timeout: ACTION_TIMEOUT });
    const surplusPrompt = a.page.getByTestId("freezer-surplus-confirm");
    await expect(surplusPrompt).toHaveAttribute("data-run-id", runIds[0], {
      timeout: ACTION_TIMEOUT,
    });
    const zeroSurplusReceiptPromise = a.page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== "/api/freezer-surplus/confirmations"
        || response.request().method() !== "POST") return false;
      try {
        const body = response.request().postDataJSON() as { runId?: string; cases?: number } | null;
        return body?.runId === runIds[0] && body.cases === 0;
      } catch {
        return false;
      }
    }, { timeout: API_TIMEOUT });
    await a.page.getByRole("button", { name: "No extra cases", exact: true })
      .click({ timeout: ACTION_TIMEOUT });
    const zeroSurplusReceipt = await zeroSurplusReceiptPromise;
    expect(zeroSurplusReceipt.status(), "new zero-surplus receipt is created through the real API").toBe(201);
    const zeroSurplusBody = await zeroSurplusReceipt.json() as {
      confirmation?: { runId?: string; cases?: number; productionDate?: string | null; lotId?: string | null };
    };
    expect(zeroSurplusBody.confirmation).toMatchObject({
      runId: runIds[0],
      cases: 0,
      productionDate: null,
      lotId: null,
    });
    await expect(surplusPrompt).toHaveCount(0, { timeout: ACTION_TIMEOUT });
    await expect(a.page.getByText("Freeze Tunnel Draining · Prior Run", { exact: true }))
      .toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(a.page.getByText("Synthetic Continuation – Primary", { exact: true }))
      .toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(a.page.getByText(`${casesDone} / ${casesNeeded} cases`, { exact: true }))
      .toBeVisible({ timeout: ACTION_TIMEOUT });
    mark("canonical-end-freeze-drain-view");
    await a.page.getByText("Freeze Tunnel Draining · Prior Run", { exact: true })
      .scrollIntoViewIfNeeded();
    await a.page.screenshot({
      path: testInfo.outputPath("accepted-end-drain.jpg"),
      fullPage: false,
    });
    if (casePlan.verifyEndSummary) {
      const openSummary = async () => {
        await a!.page.getByRole("button", { name: "More" }).click({ timeout: ACTION_TIMEOUT });
        await a!.page.getByRole("menuitem", { name: "Summary", exact: true })
          .click({ timeout: ACTION_TIMEOUT });
      };
      await openSummary();
      const finishedSummary = a.page.getByTestId(`run-summary-${runIds[0]}`);
      await expect(finishedSummary).toBeVisible({ timeout: ACTION_TIMEOUT });
      await expect(finishedSummary.getByText("Finished", { exact: true }))
        .toBeVisible({ timeout: ACTION_TIMEOUT });

      const completedHistoryRead = a.page.waitForResponse(
        (response) => response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/completed-history",
        { timeout: ACTION_TIMEOUT },
      );
      await a.page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 });
      await a.page.getByTestId("tab-run").waitFor({ state: "visible", timeout: 12_000 });
      const historyResponse = await completedHistoryRead;
      expect(historyResponse.status(), "completed history is read after reload").toBe(200);
      const historyBody = await historyResponse.json() as {
        history?: Array<{
          runId: string;
          date: string;
          snapshot?: { runValues?: Record<string, { traysOnLine?: number }> };
        }>;
      };
      const archivedCompletion = historyBody.history?.find(
        (item) => item.runId === runIds[0] && item.date === date,
      );
      expect(archivedCompletion, "accepted End is retained in immutable history").toBeTruthy();
      expect(archivedCompletion?.snapshot?.runValues?.[runIds[0]]?.traysOnLine)
        .toBe(3);
      const afterReload = await canonical(a.page, date);
      const reloadedRun = afterReload.dayState.runs.find((run) => run.id === runIds[0]);
      expect(reloadedRun?.endedAt, "accepted End survives canonical reload").toBe(receiptRun?.endedAt);
      expect(afterReload.runValues[runIds[0]]?.traysOnLine, "accepted correction survives reload")
        .toBe(3);
      await openSummary();
      const reloadedSummary = a.page.getByTestId(`run-summary-${runIds[0]}`);
      await expect(reloadedSummary).toBeVisible({ timeout: ACTION_TIMEOUT });
      await expect(reloadedSummary.getByText("Finished", { exact: true }))
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      mark("corrected-run-end-summary-visible-after-reload");
      await expect(a.page.getByText("History (1 day)", { exact: true }))
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      const archivedDay = a.page.locator('button[aria-expanded="false"]')
        .filter({ hasText: date });
      await expect(archivedDay).toHaveCount(1);
      await archivedDay.click({ timeout: ACTION_TIMEOUT });
      const matchingSummaryCards = a.page.getByTestId(`run-summary-${runIds[0]}`);
      await expect(matchingSummaryCards).toHaveCount(2);
      await expect(matchingSummaryCards.last().getByText("Finished", { exact: true }))
        .toBeVisible({ timeout: ACTION_TIMEOUT });
      mark("accepted-end-archive-visible-after-reload");
    }
  } finally {
    if (gatedPage) await releaseManualFetchGate(gatedPage).catch(() => {});
    try {
      await testInfo.attach("allowlisted-stage-markers.json", {
        body: JSON.stringify({
          evidenceId,
          case: remainingCase,
          project: projectName,
          stages,
          manualFetchDiagnostics,
        }),
        contentType: "application/json",
      });
    } catch {}
    await Promise.all([close(a), close(b)]);
  }
});
}
