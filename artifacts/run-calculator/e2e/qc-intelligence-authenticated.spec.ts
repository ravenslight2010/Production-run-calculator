import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { AuthorizedBrowserFixtures, requireDedicatedTestDatabase, uniqueTestId } from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const evidenceDir = resolve(process.cwd(), "../../.local/tasks/evidence/qc-slice-7-intelligence");

async function openQc(page: Page, origin: string) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
  await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
}

test("QC manager filters, exports and reloads effective reports while staff are denied", async ({
  browser, playwright, baseURL,
}, testInfo) => {
  test.skip(!baseURL, "Requires the isolated browser runner.");
  const apiOrigin = requireLocalFixtureApiOrigin("QC intelligence synthetic browser verification");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiOrigin, process.env.STAFF_SIGNUP_CODE ?? "");
  const db = new Client({ connectionString: requireDedicatedTestDatabase("QC intelligence synthetic browser verification") });
  const runId = uniqueTestId("qc-intelligence-run");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const errors: string[] = [];
  const responses: Array<{ status: number; path: string }> = [];
  let outcome = "NOT REACHED";
  let failure: string | null = null;
  let managerPage: Page | null = null;
  const managerNavigations: string[] = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  try {
    await db.connect();
    const manager = await fixtures.createAccount({
      username: uniqueTestId("qc-intelligence-manager"), password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"], onboardingSeen: true,
    });
    const operator = await fixtures.createAccount({
      username: uniqueTestId("qc-intelligence-operator"), password: "FixturePass123!",
      capabilities: ["record-qc"], onboardingSeen: true,
    });
    await fixtures.seedTodaySync({
      token: operator.token, senderId: uniqueTestId("qc-intelligence-sender"), date,
      payload: {
        dayState: { date, runs: [{ id: runId, brand: "Synthetic Intelligence", flavor: "Cheese", casesNeeded: 1, seeded: false }], currentIndex: 0, resetAt: 0, substitutions: [], substitutionLog: [], stagedItems: {} },
        runValues: { [runId]: { casesNeeded: 1, casesPerSkid: 12 } },
        runValuesUpdatedAt: { [runId]: Date.now() }, packagingProgress: {},
      },
    });
    const addEvent = async (type: string, payload: Record<string, unknown>, station = "sauce", relatedId: string | null = null) => {
      const result = await db.query<{ id: number }>(
        `INSERT INTO qc_workflow_events
          (scope, operation_id, record_id, event_type, run_id, ingredient_id, ingredient_name, station, actor_id, related_event_id, payload)
         VALUES ('live',$1,$2,$3,$4,'qc-synthetic-ingredient','Synthetic Ingredient',$5,$6,$7,$8::jsonb) RETURNING id`,
        [uniqueTestId("qc-intel-op"), uniqueTestId("qc-intel-record"), type, runId, station, manager.userId, relatedId, JSON.stringify(payload)],
      );
      return String(result.rows[0]!.id);
    };
    const correctedId = await addEvent("weight", {
      actualValue: 12, actualUnit: "oz", targetValue: 10, targetUnit: "oz",
      toleranceValue: 0.1, targetVersion: "synthetic-weight-v1", checkType: "pre-run", outcome: "out-of-tolerance",
    }, "dough");
    await addEvent("correction", { reason: "Synthetic correction", replacement: { actualValue: 10, station: "sauce" } }, "sauce", correctedId);
    const hiddenId = await addEvent("weight", {
      actualValue: 987654.321, actualUnit: "g", targetValue: 10, targetUnit: "g",
      toleranceValue: 0.1, targetVersion: "synthetic-weight-v2", checkType: "30-minute", outcome: "out-of-tolerance",
    }, "dough");
    await addEvent("redaction", { reason: "Synthetic redaction", fields: ["payload.actualValue"] }, "dough", hiddenId);
    await addEvent("brix-check", {
      actualBrix: 5.1, targetBrix: 5, toleranceBrix: 0.2, targetVersion: 101, checkType: "interval", outcome: "pass",
    });
    await addEvent("component-check", { outcome: "not-evaluated" });
    await addEvent("lot", { lotNumber: "SYNTHETIC-LOT-INTELLIGENCE" });
    const contextOptions = {
      viewport: testInfo.project.use.viewport as { width: number; height: number } | undefined,
      locale: testInfo.project.use.locale,
      timezoneId: testInfo.project.use.timezoneId,
      // This journey injects an API 503 using page.route. An installed worker
      // can bypass that route in WebKit; PWA lifecycle is a separate suite.
      serviceWorkers: "block" as const,
    };
    const managerContext = await browser.newContext(contextOptions);
    contexts.push(managerContext);
    await managerContext.addCookies([{ name: "rc_auth", value: manager.token, url: new URL(baseURL!).origin, httpOnly: true, sameSite: "Lax" }]);
    const page = await managerContext.newPage();
    managerPage = page;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) managerNavigations.push(new URL(frame.url()).pathname);
    });
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith("/api/qc/intelligence")) responses.push({ status: response.status(), path });
    });
    await openQc(page, baseURL!);
    const toggle = page.getByTestId("button-toggle-qc-intelligence");
    await expect(toggle).toHaveAccessibleName("QC intelligence");
    await expect(toggle).toHaveJSProperty("tabIndex", 0);
    await toggle.focus();
    await page.keyboard.press("Enter");
    const report = page.getByTestId("qc-intelligence-report");
    await expect(report).toBeVisible();
    await report.getByLabel("Run ID filter").fill(runId);
    await expect(report.getByTestId("qc-intelligence-coverage")).toContainText(runId);
    await expect(report.getByRole("table", { name: "Trend values and outcomes" })).toBeVisible();
    await expect(report).not.toContainText("987654.321");
    await report.getByLabel("Station filter").selectOption("sauce");
    await expect(report.getByTestId("qc-intelligence-coverage")).toContainText("Filters: sauce");
    const trendContext = report.getByLabel("Trend context");
    const brixValue = await trendContext.locator("option").evaluateAll((options) =>
      options.find((option) => option.textContent?.startsWith("Brix"))?.getAttribute("value"),
    );
    expect(brixValue).toBeTruthy();
    await trendContext.selectOption(brixValue!);
    await expect(report.getByRole("table", { name: "Trend values and outcomes" })).toContainText("5.1");
    const downloadWait = page.waitForEvent("download");
    await report.getByTestId("button-export-qc-intelligence").click();
    const download = await downloadWait;
    const path = await download.path();
    expect(path).toBeTruthy();
    const csv = readFileSync(path!, "utf8");
    expect(csv).toContain('"station","sauce"');
    expect(csv).toContain("synthetic-weight-v1");
    expect(csv).not.toContain("987654.321");
    await report.getByRole("button", { name: "Recorded outcomes" }).click();
    await expect(report).toContainText("Denominator: 3 recorded checks");
    await expect(report.getByRole("region", { name: "By check type" })).toContainText("Not evaluated");
    await report.getByRole("button", { name: "Lot traceability" }).click();
    await expect(report).toContainText("SYNTHETIC-LOT-INTELLIGENCE");
    await expect(report).toContainText("Synthetic Intelligence Cheese");
    await expect(report).toContainText("no explicit lot-to-customer relation is stored");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await report.getByTestId("button-qc-intelligence-trends").click();
    await expect(report.getByRole("table", { name: "Trend values and outcomes" })).toBeVisible();
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, `${testInfo.project.name}-report.jpg`), type: "jpeg", quality: 75 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByTitle("More").click();
    await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
    await page.getByTestId("button-toggle-qc-intelligence").click();
    await report.getByLabel("Run ID filter").fill(runId);
    await expect(report.getByTestId("qc-intelligence-coverage")).toContainText(runId);
    await expect(page.getByTestId("qc-intelligence-report").getByRole("table", { name: "Trend values and outcomes" })).toBeVisible();
    await page.route("**/api/qc/intelligence?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic report source unavailable"}' }));
    await report.getByLabel("From UTC date").fill(new Date().toISOString().slice(0, 10));
    await page.getByTestId("button-apply-qc-intelligence-filters").click();
    await expect(report).toHaveAttribute("data-qc-request-state", /^(retrying|error)$/, { timeout: 15_000 });
    await expect(report.getByRole("alert")).toContainText("No empty or passing result is assumed", { timeout: 15_000 });
    await page.unroute("**/api/qc/intelligence?**");
    await report.getByTestId("button-retry-qc-intelligence").click();
    await expect(report.getByRole("table", { name: "Trend values and outcomes" })).toBeVisible();

    const operatorContext = await browser.newContext(contextOptions);
    contexts.push(operatorContext);
    await operatorContext.addCookies([{ name: "rc_auth", value: operator.token, url: new URL(baseURL!).origin, httpOnly: true, sameSite: "Lax" }]);
    const operatorPage = await operatorContext.newPage();
    await openQc(operatorPage, baseURL!);
    await expect(operatorPage.getByTestId("button-toggle-qc-intelligence")).toHaveCount(0);
    for (const suffix of ["intelligence", "intelligence.csv"]) {
      const denied = await operatorContext.request.get(`${apiOrigin}/api/qc/${suffix}?view=results`, { headers: { Authorization: `Bearer ${operator.token}` } });
      expect(denied.status()).toBe(403);
    }
    expect(errors).toEqual([]);
    outcome = "PASS";
  } catch (error) {
    outcome = "FAIL";
    const browserState = await managerPage?.evaluate(() => {
      const report = document.querySelector<HTMLElement>('[data-testid="qc-intelligence-report"]');
      return {
        pathname: location.pathname,
        reportMounted: Boolean(report),
        reportState: report?.dataset.qcRequestState ?? null,
        failureCount: report?.dataset.qcFailureCount ?? null,
        runTabVisible: Boolean(document.querySelector('[data-testid="tab-run"]')),
        signInVisible: document.body.innerText.toLowerCase().includes("sign in"),
        headings: [...document.querySelectorAll<HTMLElement>("h1,h2")].map((element) => element.innerText.slice(0, 80)).slice(0, 4),
        qcIntelligenceButton: document.querySelector<HTMLElement>('[data-testid="button-toggle-qc-intelligence"]')?.innerText ?? null,
        alerts: [...document.querySelectorAll<HTMLElement>('[role="alert"]')]
          .map((element) => element.innerText.slice(0, 140)).slice(0, 2),
      };
    }).catch(() => null);
    failure = `${(error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "")} · browser state ${JSON.stringify(browserState)}`.slice(0, 500);
    throw error;
  } finally {
    for (const context of contexts) await context.close();
    // QC evidence is append-only. Retain synthetic ledger rows until the
    // isolated runner destroys this disposable database; do not disable guards.
    await db.end();
    await fixtures.cleanup({ syncDates: [date] });
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, `${testInfo.project.name}-browser-result.json`), JSON.stringify({
      capturedAt: new Date().toISOString(), outcome, failure,
      revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceState: "current workspace including task changes",
      environment: "isolated disposable PostgreSQL and local API/web",
      data: "synthetic QC fixtures only; no credentials or payloads retained",
      viewport: testInfo.project.use.viewport, browser: testInfo.project.name,
      locale: testInfo.project.use.locale, timezoneId: testInfo.project.use.timezoneId,
      serviceWorkers: "blocked for deterministic API failure injection; PWA lifecycle not tested",
      responses, pageErrors: errors, managerNavigations,
      cleanup: "accounts/roles and daily snapshot removed; append-only synthetic ledger retained until disposable database teardown",
    }, null, 2));
  }
});
