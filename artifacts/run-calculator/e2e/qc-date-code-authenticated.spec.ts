import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { AuthorizedBrowserFixtures, requireDedicatedTestDatabase, uniqueTestId } from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";
import { isBackgroundWebKitNetworkDiagnostic } from "./qc-date-code-browser-diagnostics.mjs";

async function openQc(page: Page, origin: string, navigate = true) {
  if (navigate) await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
  await expect(page.getByTestId("qc-date-code-verification")).toBeVisible();
}

test("QC records advisory date codes, approves exact text and retains a mismatch after reload", async ({ browser, playwright, baseURL }, testInfo) => {
  const apiOrigin = requireLocalFixtureApiOrigin("QC date-code synthetic verification");
  const dbUrl = requireDedicatedTestDatabase("QC date-code synthetic verification");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiOrigin, process.env.STAFF_SIGNUP_CODE ?? "");
  const runId = uniqueTestId("date-code-run");
  const brand = uniqueTestId("Date QC");
  const flavor = "Synthetic only";
  const date = new Date().toISOString().slice(0, 10);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const db = new Client({ connectionString: dbUrl });
  const diagnostics: string[] = [];
  const unexpectedPageErrors: string[] = [];
  let persistedSummary: unknown = null;
  try {
    await db.connect();
    const manager = await fixtures.createAccount({
      username: uniqueTestId("date-qc-manager"), password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"], onboardingSeen: true,
    });
    const operator = await fixtures.createAccount({
      username: uniqueTestId("date-qc-operator"), password: "FixturePass123!",
      capabilities: ["record-qc"], onboardingSeen: true,
    });
    await fixtures.seedTodaySync({
      token: manager.token, senderId: uniqueTestId("date-qc-seed"), date,
      payload: {
        dayState: { date, runs: [{ id: runId, brand, flavor, casesNeeded: 1, seeded: false }],
          currentIndex: 0, resetAt: 0, substitutions: [], substitutionLog: [], stagedItems: {} },
        runValues: { [runId]: { casesNeeded: 1, casesPerSkid: 12, pizzasPerCase: 12,
          doughRecipe: [], frontlineRecipe: [], app1Type: "", app2Type: "", app3Type: "", app4Type: "",
          pep1Type: "", pep1TypeB: "", pep2Type: "", pep2TypeB: "" } },
        runValuesUpdatedAt: { [runId]: Date.now() }, packagingProgress: {},
      },
    });
    for (const [ctx, account] of [[context, manager], [operatorContext, operator]] as const) {
      await ctx.addCookies([{ name: "rc_auth", value: account.token, url: new URL(baseURL!).origin, httpOnly: true, sameSite: "Lax" }]);
    }
    const page = await context.newPage();
    const operatorPage = await operatorContext.newPage();
    for (const p of [page, operatorPage]) {
      p.on("pageerror", (error) => {
        const entry = `${error.name}: ${error.message.slice(0, 240)}`;
        diagnostics.push(`pageerror: ${entry}`);
        if (!isBackgroundWebKitNetworkDiagnostic(error, testInfo.project.name)) unexpectedPageErrors.push(entry);
      });
      p.on("console", (message) => { if (message.type() === "error") diagnostics.push(`console: ${message.text().slice(0, 160)}`); });
    }
    await openQc(page, baseURL!);
    await openQc(operatorPage, baseURL!);
    const panel = page.getByTestId("qc-date-code-verification");
    const operatorPanel = operatorPage.getByTestId("qc-date-code-verification");
    await expect(operatorPage.getByTestId("qc-date-code-reference-manager")).toHaveCount(0);
    await expect(panel.getByTestId("button-save-date-code-check")).toBeDisabled();
    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
      { name: "tablet-portrait", width: 768, height: 1024 },
      { name: "tablet-landscape", width: 1024, height: 768 },
    ];
    for (const viewport of viewports) {
      for (const p of [page, operatorPage]) {
        await p.setViewportSize(viewport);
        const form = p.getByTestId("qc-date-code-verification");
        const bounds = await form.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        await form.getByTestId("input-date-code-batch-context").scrollIntoViewIfNeeded();
        await expect(form.getByTestId("input-date-code-batch-context")).toBeVisible();
      }
    }
    await operatorPage.setViewportSize(viewports[1]);
    await page.setViewportSize(viewports[0]);
    await operatorPanel.getByTestId("input-date-code-batch-context").fill("SYNTH-BATCH-1");
    const codeInput = operatorPanel.getByTestId("input-date-code-observed-productionCode");
    await codeInput.focus();
    await expect(codeInput).toBeFocused();
    await codeInput.fill("P-001");
    await codeInput.press("Tab");
    await expect(operatorPanel.getByTestId("button-date-code-readability-productionCode-readable")).toBeFocused();
    await operatorPanel.getByTestId("button-date-code-readability-bestByCode-unreadable").click();
    const retryIds: string[] = [];
    let failOnce = true;
    await operatorPage.route("**/api/qc/date-code-checks", async (route) => {
      retryIds.push(route.request().postDataJSON().operationId);
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic retry fixture" }) });
      } else await route.continue();
    });
    await operatorPanel.getByTestId("button-save-date-code-check").click();
    await expect(operatorPanel.getByTestId("error-date-code-check")).toBeVisible();
    await expect(codeInput).toHaveValue("P-001");
    const savedPromise = operatorPage.waitForResponse((r) => r.url().endsWith("/api/qc/date-code-checks") && r.request().method() === "POST" && r.status() === 201);
    await operatorPanel.getByTestId("error-date-code-check-retry").click();
    const saved = await (await savedPromise).json();
    expect(saved.event.payload.outcome).toBe("not-evaluated");
    expect(retryIds).toHaveLength(2);
    expect(retryIds[0]).toBe(retryIds[1]);
    await operatorPage.unroute("**/api/qc/date-code-checks");
    await expect(operatorPage.getByTestId(`qc-history-event-${saved.event.id}`)).toBeVisible();
    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await openQc(operatorPage, baseURL!, false);
    await expect(operatorPage.getByTestId(`qc-history-event-${saved.event.id}`)).toBeVisible();

    const managerPanel = page.getByTestId("qc-date-code-reference-manager");
    await managerPanel.getByTestId("input-date-code-ref-batch").fill("SYNTH-BATCH-1");
    await managerPanel.getByTestId("input-date-code-ref-expected-productionCode").fill("P-001");
    await managerPanel.getByTestId("input-date-code-ref-expected-bestByCode").fill("B-001");
    await managerPanel.getByTestId("input-date-code-ref-source-identity").fill("SYNTHETIC-SOURCE");
    await managerPanel.getByTestId("input-date-code-ref-source-version").fill("document-1");
    await managerPanel.getByTestId("input-date-code-ref-source-description").fill("Synthetic browser fixture; not an approved real date policy.");
    const referencePromise = page.waitForResponse((r) => r.url().endsWith("/api/qc/date-code-references") && r.request().method() === "POST");
    await managerPanel.getByTestId("button-save-date-code-reference").click();
    const referenceResponse = await referencePromise;
    expect(referenceResponse.status()).toBe(201);
    const reference = (await referenceResponse.json()).event;
    await expect(managerPanel.getByTestId(`card-date-code-reference-${reference.id}`)).toContainText("draft");
    await managerPanel.getByTestId("input-date-code-review-reason").fill("Synthetic reference approval only.");
    const approvalPromise = page.waitForResponse((r) => r.url().includes(`/api/qc/date-code-references/${reference.id}/review`));
    await managerPanel.getByTestId(`button-date-code-approve-${reference.id}`).click();
    expect((await approvalPromise).status()).toBe(201);
    await expect(managerPanel.getByTestId(`card-date-code-reference-${reference.id}`)).toContainText("approved");
    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await openQc(operatorPage, baseURL!, false);
    await operatorPage.setViewportSize(viewports[2]);
    await operatorPanel.getByTestId("input-date-code-batch-context").fill("SYNTH-BATCH-1");
    await operatorPanel.getByTestId("select-date-code-reference").selectOption(String(reference.id));
    await operatorPanel.getByTestId("input-date-code-observed-productionCode").fill("P-001");
    await operatorPanel.getByTestId("input-date-code-observed-bestByCode").fill("DIFFERENT-CODE");
    const mismatchPromise = operatorPage.waitForResponse((r) => r.url().endsWith("/api/qc/date-code-checks") && r.request().method() === "POST");
    await operatorPanel.getByTestId("button-save-date-code-check").click();
    const mismatchResponse = await mismatchPromise;
    expect(mismatchResponse.status()).toBe(201);
    const mismatch = (await mismatchResponse.json()).event;
    expect(mismatch.payload.outcome).toBe("fail");
    expect(mismatch.payload.referenceSnapshot.sourceVersion).toBe("document-1");
    await operatorPage.setViewportSize(viewports[3]);
    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await openQc(operatorPage, baseURL!, false);
    const historyRow = operatorPage.getByTestId(`qc-history-event-${mismatch.id}`);
    await historyRow.locator("button").first().click();
    const result = historyRow.getByTestId(`qc-date-code-result-${mismatch.id}`);
    await expect(result).toContainText("DIFFERENT-CODE");
    await expect(result).toContainText("B-001");
    await expect(result).toContainText("fail");
    await expect(result).toContainText("not a hold or release decision");
    await result.scrollIntoViewIfNeeded();
    const screenshot = testInfo.outputPath("synthetic-date-code-mismatch.jpg");
    await result.screenshot({ path: screenshot, type: "jpeg", quality: 75 });
    await testInfo.attach("synthetic-date-code-mismatch", { path: screenshot, contentType: "image/jpeg" });
    const counts = await db.query(`SELECT event_type, count(*)::int AS count FROM qc_workflow_events
      WHERE run_id = $1 OR id = $2 OR related_event_id = $2::text GROUP BY event_type ORDER BY event_type`, [runId, reference.id]);
    persistedSummary = counts.rows;
    expect(unexpectedPageErrors, "unexpected JavaScript or QC request errors").toEqual([]);
  } finally {
    await context.close();
    await operatorContext.close();
    await db.end();
    await fixtures.cleanup({ syncDates: [date] });
    await testInfo.attach("sanitized-date-code-verification", { contentType: "application/json",
      body: Buffer.from(JSON.stringify({ environment: "isolated disposable browser_e2e", data: "synthetic fixtures only",
        engine: testInfo.project.name, viewports: ["desktop", "phone", "tablet portrait", "tablet landscape"],
        physicalDevices: "not run", persistedSummary, diagnostics, unexpectedPageErrors,
        diagnosticBoundary: "Exact local WebKit network diagnostics from background auth/build/incident/field-check endpoints remain recorded, not certified as resolved.",
        cleanup: "Fixture users removed; append-only ledger retained until isolated database destruction." }, null, 2)) });
  }
});
