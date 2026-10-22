import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
  type AuthorizedTestAccount,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const VIEWPORT = { width: 1440, height: 1000 };

type AuthenticatedPage = { context: BrowserContext; page: Page };

function localDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function localDateTime(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

async function openAuthenticatedPage(
  browser: Browser,
  account: AuthorizedTestAccount,
  baseURL: string,
): Promise<AuthenticatedPage> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addCookies([{
    name: "rc_auth",
    value: account.token,
    url: new URL(baseURL).origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  return { context, page };
}

async function openQc(page: Page): Promise<void> {
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
  await expect(page.getByTestId("qc-workflow-tab")).toBeVisible();
}

function attachBrowserDiagnostics(page: Page, label: string, entries: string[]): void {
  page.on("response", (response) => {
    let pathname: string;
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      return;
    }
    if (pathname.startsWith("/api/")) {
      entries.push(`${label} ${response.request().method()} ${pathname} ${response.status()}`);
    }
  });
  page.on("pageerror", (error) => entries.push(`${label} pageerror ${error.message.slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      entries.push(`${label} console-error ${message.text().slice(0, 200)}`);
    }
  });
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("QC operator and manager complete scoped evidence workflows in authenticated browsers", async ({
  browser,
  playwright,
  baseURL,
}, testInfo) => {
  test.skip(!baseURL, "The isolated browser runner must provide a local web origin.");
  const webOrigin = baseURL!;
  const apiBase = requireLocalFixtureApiOrigin("QC authenticated browser verification");
  const fixtureDbUrl = requireDedicatedTestDatabase("QC authenticated browser verification");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiBase, SIGNUP_CODE);
  const operatorUsername = uniqueTestId("qc-operator");
  const managerUsername = uniqueTestId("qc-manager");
  const operatorRole = uniqueTestId("qc-operator-role");
  const managerRole = uniqueTestId("qc-manager-role");
  const ingredientId = uniqueTestId("qc-ingredient");
  const ingredientName = uniqueTestId("QC Flour");
  const substitutedIngredientName = uniqueTestId("Rice Flour");
  const brand = uniqueTestId("QC Browser");
  const flavor = "Evidence Review";
  const profileKey = `${brand.toLowerCase()}__${flavor.toLowerCase()}`;
  const runId = uniqueTestId("qc-run");
  const date = localDate();
  const lotNumber = uniqueTestId("LOT");
  const decoyRunId = uniqueTestId("other-scope-run");
  const decoyOperationId = uniqueTestId("other-scope-operation");
  const decoyLot = uniqueTestId("OTHER-SCOPE-LOT");
  const labelProductKey = profileKey;
  const labelSourceIdentity = uniqueTestId("SYNTHETIC-LABEL-SOURCE-v1");
  const browserEvidence: string[] = [];
  let operatorPage: AuthenticatedPage | undefined;
  let managerPage: AuthenticatedPage | undefined;
  let operator: AuthorizedTestAccount | undefined;
  let manager: AuthorizedTestAccount | undefined;
  let operatorSawSignoff = false;
  let operatorSignoffStatus: number | null = null;
  let managerSignoffStatus: number | null = null;
  let componentEventId: number | null = null;
  let labelCheckEventId: number | null = null;
  let labelReferenceEventId: number | null = null;
  let labelObservationOutcome = "not attempted";
  let labelComparisonOutcome = "not attempted";
  let exportSummary = "not attempted";
  let scopedHistorySummary = "not checked";
  let finalEventSummary: Array<{ event_type: string; scope: string; count: number }> = [];
  let crossScopeDecoyCount = 0;

  const db = new Client({ connectionString: fixtureDbUrl });
  try {
    await db.connect();
    operator = await fixtures.createAccount({
      username: operatorUsername,
      password: PASSWORD,
      capabilities: ["record-qc"],
      onboardingSeen: true,
    });
    manager = await fixtures.createAccount({
      username: managerUsername,
      password: PASSWORD,
      capabilities: ["record-qc", "manage-qc"],
      onboardingSeen: true,
    });

    const roleRows = await db.query<{ username: string; capabilities: string[] }>(
      `SELECT u.username, r.capabilities
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.name = ur.role
       WHERE u.id = ANY($1::text[])
       ORDER BY u.username`,
      [[operator.userId, manager.userId]],
    );
    expect(roleRows.rows).toHaveLength(2);
    expect(roleRows.rows.find((row) => row.username === operatorUsername)?.capabilities)
      .toEqual(["record-qc"]);
    expect(roleRows.rows.find((row) => row.username === managerUsername)?.capabilities)
      .toEqual(["record-qc", "manage-qc"]);

    await db.query(
      `INSERT INTO ingredients
         (id, scope, name, categories, allergens, allergens_reviewed)
       VALUES ($1, 'live', $2, '["general"]'::jsonb, '["milk"]'::jsonb, true)`,
      [ingredientId, ingredientName],
    );
    await db.query(
      `INSERT INTO brand_profiles
         (key, scope, brand, flavor, values, crust_values, updated_at_ms)
       VALUES ($1, 'live', $2, $3, $4::jsonb, '{}'::jsonb, $5)`,
      [
        profileKey,
        brand,
        flavor,
        JSON.stringify({
          app1Type: "cheese",
          app1CheeseRecipeName: ingredientName,
          app1OzPerPizza: 1.25,
        }),
        Date.now(),
      ],
    );
    await fixtures.seedTodaySync({
      token: manager.token,
      senderId: uniqueTestId("qc-sync-sender"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{ id: runId, brand, flavor, casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [{
            id: "qc-browser-dough-substitution",
            ingredient: ingredientName,
            action: "swap",
            substitute: substitutedIngredientName,
          }],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [runId]: {
            casesNeeded: 1,
            casesPerSkid: 12,
            doughRecipeName: "Browser Dough",
            doughRecipe: [{ ingredient: ingredientName, ingredientId, lbs: 10 }],
            frontlineRecipeName: "",
            frontlineRecipe: [],
            app1Type: "cheese",
            app1CheeseRecipeName: ingredientName,
            app1CheeseRecipe: [{ ingredient: ingredientName, ingredientId, lbs: 2 }],
            app1OzPerPizza: 1.25,
            app2Type: "",
            app2CheeseRecipeName: "",
            app2CheeseRecipe: [],
            app3Type: "",
            app3CheeseRecipeName: "",
            app3CheeseRecipe: [],
            app4Type: "",
            app4CheeseRecipeName: "",
            app4CheeseRecipe: [],
            pep1Type: "",
            pep1TypeB: "",
            pep2Type: "",
            pep2TypeB: "",
          },
        },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });
    await db.query(
      `INSERT INTO qc_workflow_events
         (scope, operation_id, record_id, event_type, run_id, actor_id, payload)
       VALUES ('sandbox', $1, $2, 'lot', $3, $4, $5::jsonb)`,
      [
        decoyOperationId,
        uniqueTestId("other-scope-record"),
        decoyRunId,
        manager.userId,
        JSON.stringify({ lotNumber: decoyLot }),
      ],
    );

    operatorPage = await openAuthenticatedPage(browser, operator, webOrigin);
    managerPage = await openAuthenticatedPage(browser, manager, webOrigin);
    attachBrowserDiagnostics(operatorPage.page, "operator", browserEvidence);
    attachBrowserDiagnostics(managerPage.page, "manager", browserEvidence);

    await openQc(managerPage.page);
    await expect(managerPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    await expect(managerPage.page.getByText("Reviewed targets", { exact: true })).toBeVisible();
    const targetSection = managerPage.page.locator('section[aria-labelledby="qc-target-title"]');
    await expect(targetSection.getByTestId("qc-weight-target-list").getByText(ingredientName, { exact: true })).toBeVisible();
    await expect(targetSection.getByText(/1\.25 oz/)).toBeVisible();
    await capture(managerPage.page, testInfo, "manager-reviewed-target-before-override");

    await managerPage.page.getByTestId("select-target-ingredient").selectOption({ label: ingredientName });
    await managerPage.page.getByTestId("input-target-value").fill("1.3");
    await managerPage.page.getByTestId("input-tolerance").fill("0.2");
    await managerPage.page.getByTestId("textarea-reason-for-review").fill("Fixture reviewed target");
    await managerPage.page.getByRole("button", { name: "Save reviewed target", exact: true }).click();
    await expect(managerPage.page.getByText(/1\.3 oz ±0\.2 · QC override/)).toBeVisible();

    const referenceManager = managerPage.page.getByTestId("qc-label-reference-manager");
    await referenceManager.getByLabel("Manager-defined product key").fill(labelProductKey);
    await referenceManager.getByLabel("Expected product name").fill("Synthetic Cheese");
    await referenceManager.getByLabel("Expected lot text").fill("LOT-30");
    await referenceManager.getByLabel("Expected date text").fill("2030-11-30");
    await referenceManager.getByLabel("Source identity").fill(labelSourceIdentity);
    await referenceManager.getByLabel("Source description").fill("Synthetic browser fixture only; not an operational label master.");
    const referenceSaveResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-references")
      && response.request().method() === "POST");
    await referenceManager.getByRole("button", { name: "Save new draft reference", exact: true }).click();
    const referenceSaveResponse = await referenceSaveResponsePromise;
    expect(referenceSaveResponse.status()).toBe(201);
    const referenceSaveBody = await referenceSaveResponse.json() as {
      event: { id: number; payload: { referenceId: string; version: number } };
    };
    labelReferenceEventId = referenceSaveBody.event.id;
    expect(referenceSaveBody.event.payload.version).toBe(1);
    const draftReferenceCard = referenceManager.locator("article").filter({ hasText: labelProductKey });
    await expect(draftReferenceCard).toContainText("draft");
    await expect(draftReferenceCard.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await referenceManager.getByLabel("Approval or withdrawal reason").fill("Approve this synthetic browser reference only.");
    const approveReferencePromise = managerPage.page.waitForResponse((response) =>
      response.url().includes(`/api/qc/label-references/${labelReferenceEventId}/review`)
      && response.request().method() === "POST");
    await draftReferenceCard.getByRole("button", { name: "Approve", exact: true }).click();
    expect((await approveReferencePromise).status()).toBe(201);
    await expect(draftReferenceCard).toContainText("approved");

    await openQc(operatorPage.page);
    await expect(operatorPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    const componentChecklist = operatorPage.page.getByTestId("qc-component-checklist");
    await expect(componentChecklist.getByText("Expected list complete", { exact: true })).toBeVisible();
    await expect(componentChecklist.getByText(substitutedIngredientName, { exact: true })).toHaveCount(2);
    const labelPanel = operatorPage.page.getByTestId("qc-label-verification");
    await expect(labelPanel.getByText("Observation-only mode", { exact: true })).toBeVisible();
    const responsiveViewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
      { name: "tablet-portrait", width: 768, height: 1024 },
      { name: "tablet-landscape", width: 1024, height: 768 },
    ] as const;
    for (const viewport of responsiveViewports) {
      await operatorPage.page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(componentChecklist).toBeVisible();
      const sectionBounds = await componentChecklist.boundingBox();
      expect(sectionBounds, `${viewport.name} checklist layout`).not.toBeNull();
      expect(sectionBounds!.x).toBeGreaterThanOrEqual(0);
      expect(sectionBounds!.x + sectionBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      const documentWidth = await operatorPage.page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth, `${viewport.name} page has no horizontal overflow`).toBeLessThanOrEqual(viewport.width);
      const labelBounds = await labelPanel.boundingBox();
      expect(labelBounds, `${viewport.name} label panel layout`).not.toBeNull();
      expect(labelBounds!.x).toBeGreaterThanOrEqual(0);
      expect(labelBounds!.x + labelBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      await expect(labelPanel.getByLabel("Observed product name")).toBeVisible();
      await capture(operatorPage.page, testInfo, `operator-component-check-${viewport.name}`);
    }
    await operatorPage.page.setViewportSize(VIEWPORT);
    const doughObservation = componentChecklist.getByLabel(`Observation for ${substitutedIngredientName} (Dough)`);
    await doughObservation.focus();
    await expect(doughObservation).toBeFocused();
    await doughObservation.press("ArrowDown");
    await expect(doughObservation).toHaveValue("present-correct");
    const observedProductInput = labelPanel.getByLabel("Observed product name");
    const observedLotInput = labelPanel.getByLabel("Observed lot text");
    await observedProductInput.focus();
    await expect(observedProductInput).toBeFocused();
    await observedProductInput.press("Tab");
    await expect(observedLotInput).toBeFocused();
    await operatorPage.page.setViewportSize(VIEWPORT);

    const labelRetryBodies: Array<{ operationId: string }> = [];
    let failLabelRequestOnce = true;
    await operatorPage.page.route("**/api/qc/label-checks", async (route) => {
      if (route.request().method() === "POST") {
        labelRetryBodies.push(route.request().postDataJSON() as { operationId: string });
        if (failLabelRequestOnce) {
          failLabelRequestOnce = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic retry fixture failure" }),
          });
          return;
        }
      }
      await route.continue();
    });
    await observedProductInput.fill("Observed synthetic cheese");
    await observedLotInput.fill("LOT-30");
    await labelPanel.getByLabel("Observed date text").fill("11/30/30");
    const failedLabelResponse = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-checks") && response.request().method() === "POST");
    await labelPanel.getByRole("button", { name: "Save observation", exact: true }).click();
    expect((await failedLabelResponse).status()).toBe(503);
    await expect(labelPanel.getByRole("alert")).toBeVisible();
    await expect(labelPanel.getByLabel("Observed product name")).toHaveValue("Observed synthetic cheese");
    const retriedLabelResponse = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-checks") && response.request().method() === "POST");
    await labelPanel.getByRole("button", { name: "Retry saved values", exact: true }).click();
    const savedObservationResponse = await retriedLabelResponse;
    expect(savedObservationResponse.status()).toBe(201);
    const savedObservation = await savedObservationResponse.json() as {
      event: { id: number; payload: Record<string, any> };
    };
    expect(savedObservation.event.payload).toMatchObject({
      outcome: "not-evaluated",
      referenceSnapshot: null,
    });
    labelObservationOutcome = String(savedObservation.event.payload.outcome);
    expect(labelRetryBodies).toHaveLength(2);
    expect(labelRetryBodies[0]?.operationId).toBe(labelRetryBodies[1]?.operationId);
    await operatorPage.page.unroute("**/api/qc/label-checks");
    await expect(operatorPage.page.getByTestId(`qc-history-event-${savedObservation.event.id}`)).toBeVisible();
    await capture(operatorPage.page, testInfo, "operator-observation-only-label-saved");

    const approvedReferenceOption = `${labelProductKey} · v1`;
    await labelPanel.getByLabel("Approved reference").selectOption({ label: approvedReferenceOption });
    await labelPanel.getByLabel("Observed product name").fill("Synthetic Cheese");
    await labelPanel.getByLabel("Observed lot text").fill("LOT-30");
    await labelPanel.getByLabel("Observed date text").fill("11/30/30");
    const mismatchResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-checks") && response.request().method() === "POST");
    await labelPanel.getByRole("button", { name: "Save observation", exact: true }).click();
    const mismatchResponse = await mismatchResponsePromise;
    expect(mismatchResponse.status()).toBe(201);
    const mismatchBody = await mismatchResponse.json() as {
      event: { id: number; payload: Record<string, any> };
    };
    expect(mismatchBody.event.payload).toMatchObject({
      outcome: "fail",
      referenceSnapshot: {
        version: 1,
        sourceIdentity: labelSourceIdentity,
        expected: { productName: "Synthetic Cheese", dateText: "2030-11-30" },
      },
      fieldResults: {
        productName: { state: "pass" },
        lotText: { state: "pass" },
        dateText: { state: "fail" },
      },
    });
    labelComparisonOutcome = String(mismatchBody.event.payload.outcome);

    await operatorPage.page.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(operatorPage.page);
    const persistedMismatch = operatorPage.page.getByTestId(`qc-history-event-${mismatchBody.event.id}`);
    await persistedMismatch.locator("button").first().click();
    await expect(persistedMismatch).toContainText("fail");

    const managerReferenceCard = referenceManager.locator("article").filter({ hasText: labelProductKey });
    await managerReferenceCard.getByRole("button", { name: "New version", exact: true }).click();
    await referenceManager.getByLabel("Expected date text").fill("11/30/30");
    await referenceManager.getByLabel("Source identity").fill(`${labelSourceIdentity}-v2`);
    await referenceManager.getByLabel("Source description").fill("Synthetic browser fixture version two; not an operational source.");
    const secondVersionResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-references")
      && response.request().method() === "POST");
    await referenceManager.getByRole("button", { name: "Save new draft version", exact: true }).click();
    const secondVersionResponse = await secondVersionResponsePromise;
    expect(secondVersionResponse.status()).toBe(201);
    const secondVersion = await secondVersionResponse.json() as {
      event: { id: number; payload: { version: number } };
    };
    expect(secondVersion.event.payload.version).toBe(2);

    const staleOption = `${labelProductKey} · v1`;
    await labelPanel.getByLabel("Approved reference").selectOption({ label: staleOption });
    await labelPanel.getByLabel("Observed product name").fill("Synthetic Cheese");
    await labelPanel.getByLabel("Observed lot text").fill("LOT-30");
    await labelPanel.getByLabel("Observed date text").fill("11/30/30");
    const staleReferenceResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-checks") && response.request().method() === "POST");
    await labelPanel.getByRole("button", { name: "Save observation", exact: true }).click();
    const staleReferenceResponse = await staleReferenceResponsePromise;
    expect(staleReferenceResponse.status()).toBe(201);
    const staleReferenceBody = await staleReferenceResponse.json() as {
      event: { payload: Record<string, any> };
    };
    expect(staleReferenceBody.event.payload).toMatchObject({
      outcome: "not-evaluated",
      referenceSnapshot: { version: 2, state: "draft" },
    });

    await referenceManager.getByLabel("Approval or withdrawal reason").fill("Approve synthetic browser reference version two.");
    const approveSecondVersionPromise = managerPage.page.waitForResponse((response) =>
      response.url().includes(`/api/qc/label-references/${secondVersion.event.id}/review`)
      && response.request().method() === "POST");
    await managerReferenceCard.getByRole("button", { name: "Approve", exact: true }).click();
    expect((await approveSecondVersionPromise).status()).toBe(201);

    await operatorPage.page.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(operatorPage.page);
    const refreshedLabelPanel = operatorPage.page.getByTestId("qc-label-verification");
    await refreshedLabelPanel.getByLabel("Approved reference").selectOption({ label: `${labelProductKey} · v2` });
    await refreshedLabelPanel.getByLabel("Observed product name").fill("Synthetic Cheese");
    await refreshedLabelPanel.getByLabel("Observed lot text").fill("LOT-30");
    await refreshedLabelPanel.getByLabel("Observed date text").fill("11/30/30");
    const passResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/label-checks") && response.request().method() === "POST");
    await refreshedLabelPanel.getByRole("button", { name: "Save observation", exact: true }).click();
    const passResponse = await passResponsePromise;
    expect(passResponse.status()).toBe(201);
    const passBody = await passResponse.json() as {
      event: { id: number; payload: Record<string, any> };
    };
    expect(passBody.event.payload).toMatchObject({
      outcome: "pass",
      referenceSnapshot: { version: 2, sourceIdentity: `${labelSourceIdentity}-v2` },
    });
    labelCheckEventId = passBody.event.id;
    const passingLabelEvent = operatorPage.page.getByTestId(`qc-history-event-${labelCheckEventId}`);
    await passingLabelEvent.locator("button").first().click();
    await expect(passingLabelEvent).toContainText("pass");
    await capture(operatorPage.page, testInfo, "operator-approved-reference-label-comparison");

    await componentChecklist.getByLabel(`Observation for ${substitutedIngredientName} (Dough)`).selectOption("present-correct");
    await componentChecklist.getByLabel(`Observation for ${substitutedIngredientName} (Applicator 1)`).selectOption("present-correct");
    const componentResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/component-checks")
      && response.request().method() === "POST");
    await componentChecklist.getByRole("button", { name: "Record checklist", exact: true }).click();
    const componentResponse = await componentResponsePromise;
    expect(componentResponse.status()).toBe(201);
    const componentResponseBody = await componentResponse.json() as {
      event: { id: number; payload: { outcome: string } };
    };
    componentEventId = componentResponseBody.event.id;
    expect(componentResponseBody.event.payload.outcome).toBe("pass");
    const componentEvent = operatorPage.page.getByTestId(`qc-history-event-${componentEventId}`);
    await expect(componentEvent).toBeVisible();
    await componentEvent.locator("button").first().click();
    await expect(componentEvent).toContainText("Component checklist result");
    await expect(componentEvent).toContainText("pass");
    await capture(operatorPage.page, testInfo, "operator-component-check-saved");

    const managerOnlyUiBefore = {
      targetEditor: await operatorPage.page.getByText("Set or clear an override", { exact: true }).count(),
      export: await operatorPage.page.getByRole("button", { name: "Export CSV", exact: true }).count(),
      managerReviewBadge: await operatorPage.page.getByText("Manager review", { exact: true }).count(),
      signoffNote: await operatorPage.page.getByLabel("Sign-off note (optional)").count(),
      signoffButton: await operatorPage.page.getByRole("button", { name: "Sign off reviewed set", exact: true }).count(),
    };
    expect(managerOnlyUiBefore).toEqual({
      targetEditor: 0,
      export: 0,
      managerReviewBadge: 0,
      signoffNote: 0,
      signoffButton: 0,
    });

    await operatorPage.page.getByTestId("select-ingredient").selectOption({ label: ingredientName });
    await operatorPage.page.getByTestId("input-lot-number").fill(lotNumber);
    const lotResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/lots")
      && response.request().method() === "POST");
    await operatorPage.page.getByRole("button", { name: "Record lot", exact: true }).click();
    expect((await lotResponsePromise).status()).toBe(201);
    const lotEvent = operatorPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: "lot" }).first();
    await expect(lotEvent).toBeVisible();
    await lotEvent.locator("button").first().click();
    await expect(lotEvent).toContainText(`lotNumber: ${lotNumber}`);

    await operatorPage.page.getByTestId("tab-qc-weights").click();
    await operatorPage.page.getByTestId("select-ingredient").selectOption({ label: ingredientName });
    await expect(operatorPage.page.getByText("Target 1.3 oz · tolerance ±0.2 oz")).toBeVisible();
    await operatorPage.page.getByTestId("input-actual-weight").fill("1.35");
    const weightResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/weight-checks")
      && response.request().method() === "POST");
    await operatorPage.page.getByRole("button", { name: "Record weight check", exact: true }).click();
    expect((await weightResponsePromise).status()).toBe(201);
    const weightEvent = operatorPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: "weight" }).first();
    await expect(weightEvent).toBeVisible();
    await weightEvent.locator("button").first().click();
    await expect(weightEvent).toContainText("actualValue: 1.35");

    await operatorPage.page.getByTestId("select-staged-ingredients-review").selectOption("reviewed");
    await operatorPage.page.getByTestId("select-cleaning-review").selectOption("unverified");
    await operatorPage.page.getByLabel("Review note (optional)").fill("Fixture allergen footprint reviewed; mapping remains advisory.");
    await operatorPage.page.getByTestId("checkbox-footprint-reviewed").check();
    const allergenResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/allergen-reviews")
      && response.request().method() === "POST");
    await operatorPage.page.getByRole("button", { name: "Save pre-run review", exact: true }).click();
    expect((await allergenResponsePromise).status()).toBe(201);
    const allergenEvent = operatorPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: "allergen review" }).first();
    await expect(allergenEvent).toBeVisible();
    await allergenEvent.locator("button").first().click();
    await expect(allergenEvent).toContainText("stagedIngredientsStatus: reviewed");
    await expect(allergenEvent).toContainText("cleaningStatus: unverified");

    const now = Date.now();
    await operatorPage.page.getByTestId("input-started-at").fill(localDateTime(new Date(now - 5 * 60_000)));
    await operatorPage.page.getByTestId("input-ended-at").fill(localDateTime(new Date(now - 60_000)));
    await operatorPage.page.getByLabel("Cleaning note (optional)").fill("Fixture cleaning record");
    const cleaningResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().includes("/api/qc/cleaning-records")
      && response.request().method() === "POST");
    await operatorPage.page.getByRole("button", { name: "Record cleaning", exact: true }).click();
    expect((await cleaningResponsePromise).status()).toBe(201);
    const cleaningEvent = operatorPage.page
      .getByTestId(/^qc-history-event-/)
      .filter({ has: operatorPage.page.getByText("cleaning", { exact: true }) })
      .first();
    await expect(cleaningEvent).toBeVisible();
    await cleaningEvent.locator("button").first().click();
    await expect(cleaningEvent.getByText("Payload", { exact: true })).toBeVisible();
    await expect(cleaningEvent).toContainText("note: Fixture cleaning record");

    for (const eventType of ["lot", "weight", "allergen review", "cleaning"]) {
      await expect(
        operatorPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: eventType }).first(),
      ).toBeVisible();
    }
    const firstEvent = operatorPage.page.getByTestId(/^qc-history-event-/).first();
    await expect(firstEvent.getByText("Payload", { exact: true })).toBeVisible();
    expect(await operatorPage.page.getByText("Append correction", { exact: true }).count()).toBe(0);
    expect(await operatorPage.page.getByText("Append privacy redaction", { exact: true }).count()).toBe(0);

    const operatorSignoff = operatorPage.page.getByRole("button", { name: "Sign off reviewed set", exact: true });
    operatorSawSignoff = await operatorSignoff.count() > 0;
    if (operatorSawSignoff) {
      const denied = operatorPage.page.waitForResponse((response) =>
        response.url().endsWith("/api/qc/run-signoffs")
        && response.request().method() === "POST");
      await operatorSignoff.click();
      const response = await denied;
      operatorSignoffStatus = response.status();
      expect(operatorSignoffStatus).toBe(403);
      await expect(operatorPage.page.getByRole("alert")).toBeVisible();
    } else {
      const denied = await operatorPage.page.evaluate(async ({ id, operationId }) => {
        const response = await fetch("/api/qc/run-signoffs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId, runId: id }),
        });
        return response.status;
      }, { id: runId, operationId: uniqueTestId("operator-denied-signoff") });
      operatorSignoffStatus = denied;
      expect(denied).toBe(403);
    }
    await capture(operatorPage.page, testInfo, "operator-qc-records-and-role-boundary");
    const signoffRowsAfterOperator = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM qc_workflow_events
       WHERE scope = 'live' AND run_id = $1 AND event_type = 'run-signoff'`,
      [runId],
    );
    expect(signoffRowsAfterOperator.rows[0]?.count).toBe("0");

    await managerPage.page.reload({ waitUntil: "domcontentloaded" });
    await managerPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(managerPage.page);
    const managerCleaningEvent = managerPage.page
      .getByTestId(/^qc-history-event-/)
      .filter({ has: managerPage.page.getByText("cleaning", { exact: true }) })
      .first();
    await expect(managerCleaningEvent).toBeVisible();
    await managerCleaningEvent.locator("button").first().click();
    await managerCleaningEvent.getByRole("button", { name: "Verify cleaning", exact: true }).click();
    await managerCleaningEvent.getByRole("button", { name: "Verify as another person", exact: true }).click();
    await expect(
      managerPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: "cleaning verification" }),
    ).toBeVisible();

    if (componentEventId !== null) {
      const managerComponentEvent = managerPage.page.getByTestId(`qc-history-event-${componentEventId}`);
      await expect(managerComponentEvent).toBeVisible();
      await managerComponentEvent.locator("button").first().click();
      await managerComponentEvent.getByLabel("Correction reason").fill("Correct identity observation");
      await managerComponentEvent.getByLabel("Replacement payload JSON").fill(JSON.stringify({
        observations: [{ componentId: "dough:0", observation: "present-mismatch" }],
      }));
      const correctionResponsePromise = managerPage.page.waitForResponse((response) =>
        response.url().includes(`/api/qc/events/${componentEventId}/corrections`)
        && response.request().method() === "POST");
      await managerComponentEvent.getByRole("button", { name: "Append correction", exact: true }).click();
      expect((await correctionResponsePromise).status()).toBe(201);
      await expect(managerComponentEvent.getByText("Corrected", { exact: true })).toBeVisible();
      await expect(managerComponentEvent).toContainText("fail");

      await managerComponentEvent.getByLabel("Redaction reason").fill("Redact expected identities in the display");
      await managerComponentEvent.getByLabel("Expected component identities").check();
      const redactionResponsePromise = managerPage.page.waitForResponse((response) =>
        response.url().includes(`/api/qc/events/${componentEventId}/redactions`)
        && response.request().method() === "POST");
      await managerComponentEvent.getByRole("button", { name: "Append redaction", exact: true }).click();
      expect((await redactionResponsePromise).status()).toBe(201);
      await expect(managerComponentEvent).toContainText("Expected component identities were redacted.");
    }

    const recordsBeforeSignoff = await db.query<{ id: string }>(
      `SELECT COALESCE(MAX(id), 0)::text AS id
       FROM qc_workflow_events
       WHERE scope = 'live' AND run_id = $1
         AND event_type NOT IN ('run-signoff', 'target-setting')`,
      [runId],
    );
    const expectedReviewedThroughId = Number(recordsBeforeSignoff.rows[0]?.id ?? 0);
    const managerSignoff = managerPage.page.getByRole("button", { name: "Sign off reviewed set", exact: true });
    const managerSignoffResponse = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/run-signoffs")
      && response.request().method() === "POST");
    await managerSignoff.click();
    managerSignoffStatus = (await managerSignoffResponse).status();
    expect(managerSignoffStatus).toBe(201);
    const managerSignoffBody = await managerSignoffResponse.then((response) => response.json()) as {
      event: { actorId: string; payload: { reviewedThroughId: number } };
    };
    expect(managerSignoffBody.event).toMatchObject({
      actorId: manager.userId,
      payload: { reviewedThroughId: expectedReviewedThroughId },
    });
    await expect(managerPage.page.getByText("Signed off", { exact: true })).toBeVisible();
    await capture(managerPage.page, testInfo, "manager-signed-off-history");

    await managerPage.page.getByTestId("input-run-id-filter").fill("");
    const downloadPromise = managerPage.page.waitForEvent("download");
    const exportResponsePromise = managerPage.page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/qc/history.csv"
      && response.request().method() === "GET");
    await managerPage.page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const [download, exportResponse] = await Promise.all([downloadPromise, exportResponsePromise]);
    expect(exportResponse.status()).toBe(200);
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    expect(download.suggestedFilename()).toMatch(/^qc-history-\d{4}-\d{2}-\d{2}\.csv$/);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("The QC CSV download did not produce a readable file.");
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(downloadPath, "utf8");
    expect(csv).toContain(lotNumber);
    expect(csv).toContain(runId);
    expect(csv).toContain("component-check");
    expect(csv).toContain("label-check");
    expect(csv).toContain("label-reference");
    expect(csv).toContain(labelProductKey);
    expect(csv).toContain("run-signoff");
    expect(csv).not.toContain(decoyLot);
    exportSummary = `downloaded ${csv.split(/\r?\n/).filter(Boolean).length - 1} fixture rows; label reference/check, lot, run, and sign-off present`;

    if (componentEventId !== null) {
      const managerComponentEvent = managerPage.page.getByTestId(`qc-history-event-${componentEventId}`);
      await managerComponentEvent.getByLabel("Correction reason").fill("Correct identity after sign-off");
      await managerComponentEvent.getByLabel("Replacement payload JSON").fill(JSON.stringify({
        observations: [{ componentId: "dough:0", observation: "present-correct" }],
      }));
      const postSignoffCorrection = managerPage.page.waitForResponse((response) =>
        response.url().includes(`/api/qc/events/${componentEventId}/corrections`)
        && response.request().method() === "POST");
      await managerComponentEvent.getByRole("button", { name: "Append correction", exact: true }).click();
      expect((await postSignoffCorrection).status()).toBe(201);
      await expect(managerPage.page.getByText("Reopened", { exact: true })).toBeVisible();
    }

    if (labelCheckEventId !== null) {
      const managerLabelEvent = managerPage.page.getByTestId(`qc-history-event-${labelCheckEventId}`);
      await expect(managerLabelEvent).toBeVisible();
      await managerLabelEvent.locator("button").first().click();
      await managerLabelEvent.getByLabel("Correction reason").fill("Correct synthetic printed-date transcription.");
      await managerLabelEvent.getByLabel("Replacement payload JSON").fill(JSON.stringify({
        observed: { dateText: "incorrect date text" },
      }));
      const labelCorrectionPromise = managerPage.page.waitForResponse((response) =>
        response.url().includes(`/api/qc/events/${labelCheckEventId}/corrections`)
        && response.request().method() === "POST");
      await managerLabelEvent.getByRole("button", { name: "Append correction", exact: true }).click();
      expect((await labelCorrectionPromise).status()).toBe(201);
      await expect(managerLabelEvent.getByText("Corrected", { exact: true })).toBeVisible();
      await expect(managerLabelEvent).toContainText("fail");

      await managerLabelEvent.getByLabel("Redaction reason").fill("Redact synthetic date text in this fixture.");
      await managerLabelEvent.getByLabel("Observed date text", { exact: true }).check();
      const labelRedactionPromise = managerPage.page.waitForResponse((response) =>
        response.url().includes(`/api/qc/events/${labelCheckEventId}/redactions`)
        && response.request().method() === "POST");
      await managerLabelEvent.getByRole("button", { name: "Append redaction", exact: true }).click();
      expect((await labelRedactionPromise).status()).toBe(201);
      await expect(managerLabelEvent).toContainText("Redacted");
      const reopenedLabelRun = await managerPage.page.evaluate(async (id) => {
        const response = await fetch(`/api/qc/runs/${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error(`Run history returned ${response.status}`);
        return response.json() as Promise<{ signoff: { signedOff: boolean; reopened: boolean } }>;
      }, runId);
      expect(reopenedLabelRun.signoff).toMatchObject({ signedOff: false, reopened: true });
    }

    await managerPage.page.reload({ waitUntil: "domcontentloaded" });
    await managerPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(managerPage.page);
    await expect(managerPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    await expect(managerPage.page.getByText("Reopened", { exact: true })).toBeVisible();
    const persistedHistory = managerPage.page.getByTestId(/^qc-history-event-/);
    const persistedLotEvent = persistedHistory
      .filter({ has: managerPage.page.getByText("lot", { exact: true }) })
      .first();
    await expect(persistedLotEvent).toBeVisible();
    await persistedLotEvent.locator("button").first().click();
    await expect(persistedLotEvent).toContainText(lotNumber);
    await expect(persistedHistory.filter({ has: managerPage.page.getByText("weight", { exact: true }) })).toBeVisible();
    await expect(persistedHistory.filter({ has: managerPage.page.getByText("allergen review", { exact: true }) })).toBeVisible();
    await expect(persistedHistory.filter({ has: managerPage.page.getByText("cleaning", { exact: true }) })).toBeVisible();
    await expect(persistedHistory.filter({ hasText: "cleaning verification" })).toBeVisible();
    if (componentEventId !== null) {
      const persistedComponentEvent = managerPage.page.getByTestId(`qc-history-event-${componentEventId}`);
      await persistedComponentEvent.locator("button").first().click();
      await expect(persistedComponentEvent).toContainText("Expected component identities were redacted.");
      await expect(persistedComponentEvent).toContainText("Corrected");
    }
    await expect(managerPage.page.getByText(/1\.3 oz ±0\.2 · QC override/)).toBeVisible();
    await capture(managerPage.page, testInfo, "manager-qc-state-after-reload");

    const facilityHistoryResponse = managerPage.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/qc/history"
        && response.request().method() === "GET"
        && !url.searchParams.get("runId");
    });
    await managerPage.page.getByTestId("input-run-id-filter").fill("");
    const facilityHistory = await facilityHistoryResponse;
    expect(facilityHistory.status()).toBe(200);
    const facilityHistoryBody = await facilityHistory.json() as {
      items?: Array<{ runId?: string | null }>;
    };
    expect(facilityHistoryBody.items?.some((item) => item.runId === runId)).toBe(true);
    expect(facilityHistoryBody.items?.some((item) => item.runId === decoyRunId)).toBe(false);
    scopedHistorySummary = `facility history returned ${facilityHistoryBody.items?.length ?? 0} events; sandbox decoy excluded`;
    await expect(
      managerPage.page.getByTestId(/^qc-history-event-/).filter({ hasText: decoyRunId }),
    ).toHaveCount(0);

    const eventRows = await db.query<{ event_type: string; scope: string; count: number }>(
      `SELECT event_type, scope, count(*)::int AS count
       FROM qc_workflow_events
       WHERE (run_id = $1 OR profile_key = $2 OR record_id = (
         SELECT record_id FROM qc_workflow_events WHERE id = $3 AND scope = 'live'
       ))
       GROUP BY event_type, scope
       ORDER BY scope, event_type`,
      [runId, profileKey, labelReferenceEventId],
    );
    finalEventSummary = eventRows.rows;
    const decoyRows = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM qc_workflow_events
       WHERE scope = 'sandbox' AND run_id = $1 AND operation_id = $2`,
      [decoyRunId, decoyOperationId],
    );
    crossScopeDecoyCount = decoyRows.rows[0]?.count ?? 0;
    expect(crossScopeDecoyCount).toBe(1);
    const liveEventTypes = new Set(
      eventRows.rows.filter((row) => row.scope === "live").map((row) => row.event_type),
    );
    for (const expectedType of [
      "target-setting",
      "lot",
      "weight",
      "component-check",
      "label-check",
      "label-reference",
      "label-reference-review",
      "allergen-review",
      "cleaning",
      "cleaning-verification",
      "run-signoff",
    ]) {
      expect(liveEventTypes.has(expectedType), `missing persisted ${expectedType} evidence`).toBe(true);
    }
    expect(eventRows.rows.filter((row) => row.scope === "sandbox")).toHaveLength(0);
  } finally {
    await operatorPage?.context.close().catch(() => {});
    await managerPage?.context.close().catch(() => {});
    // The QC ledger is protected against DELETE, including fixture rows.
    // Unique IDs isolate engines; the isolated suite runner drops the entire
    // disposable database afterward. Never suppress a failed ledger deletion.
    await db.query(
      "DELETE FROM ingredients WHERE scope = 'live' AND id = $1",
      [ingredientId],
    ).catch(() => {});
    await db.end().catch(() => {});
    await fixtures.cleanup({ profileKeys: [profileKey], syncDates: [date] });
    const backendEvidence = {
      environment: "fresh local disposable browser_e2e PostgreSQL",
      data: "generated browser fixtures only; no production records",
      ledgerCleanup: "Append-only fixture rows remain between engines; the isolated runner destroys the disposable database.",
      facilityScope: "live",
      runId,
      roleCapabilities: {
        operator: ["record-qc"],
        manager: ["record-qc", "manage-qc"],
      },
      operatorSawSignoff,
      operatorSignoffStatus,
      managerSignoffStatus,
      componentEventId,
      labelReferenceEventId,
      labelCheckEventId,
      labelObservationOutcome,
      labelComparisonOutcome,
      exportSummary,
      scopedHistorySummary,
      persistedEvents: finalEventSummary,
      sandboxDecoyRows: crossScopeDecoyCount,
      qcApiResponses: browserEvidence,
      noCredentialsOrRequestBodies: true,
    };
    const evidencePath = testInfo.outputPath("qc-browser-backend-evidence.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(evidencePath, `${JSON.stringify(backendEvidence, null, 2)}\n`);
    await testInfo.attach("qc-browser-backend-evidence.json", {
      path: evidencePath,
      contentType: "application/json",
    });
    await testInfo.attach("qc-browser-console-summary.txt", {
      body: Buffer.from(browserEvidence.length ? browserEvidence.join("\n") : "No console errors or QC API responses captured."),
      contentType: "text/plain",
    });
  }
  expect(operatorSawSignoff, "QC operators must not be shown the manager-only sign-off control").toBe(false);
});
