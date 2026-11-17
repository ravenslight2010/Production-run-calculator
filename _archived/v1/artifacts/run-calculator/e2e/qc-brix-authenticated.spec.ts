import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  type ViewportSize,
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

type AuthenticatedPage = { context: BrowserContext; page: Page };

function facilityDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function openAuthenticatedPage(
  browser: Browser,
  account: AuthorizedTestAccount,
  baseURL: string,
  viewport: ViewportSize | null | undefined,
): Promise<AuthenticatedPage> {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    timezoneId: "America/Chicago",
  });
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

test("QC manager and operator record, correct, and sign off Brix evidence", async ({
  browser,
  playwright,
  baseURL,
}, testInfo) => {
  test.skip(!baseURL, "The isolated browser runner must provide a local web origin.");
  const webOrigin = baseURL!;
  const apiBase = requireLocalFixtureApiOrigin("Brix authenticated browser verification");
  const fixtureDbUrl = requireDedicatedTestDatabase("Brix authenticated browser verification");
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, apiBase, SIGNUP_CODE);
  const operatorUsername = uniqueTestId("brix-operator");
  const managerUsername = uniqueTestId("brix-manager");
  const ingredientId = uniqueTestId("brix-ingredient");
  const ingredientName = uniqueTestId("Brix Ingredient");
  const brand = uniqueTestId("Brix Browser");
  const flavor = "Reviewed Target";
  const profileKey = `${brand.toLowerCase()}__${flavor.toLowerCase()}`;
  const runId = uniqueTestId("brix-run");
  const date = facilityDate();
  const browserEvidence: string[] = [];
  const viewport = testInfo.project.use.viewport as ViewportSize | null | undefined;
  let operatorPage: AuthenticatedPage | undefined;
  let managerPage: AuthenticatedPage | undefined;
  let operator: AuthorizedTestAccount | undefined;
  let manager: AuthorizedTestAccount | undefined;
  let exportSummary = "not attempted";
  let correctionStatus: number | null = null;
  let redactionStatus: number | null = null;
  const signoffStatuses: number[] = [];
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
      `INSERT INTO ingredients (id, scope, name, categories, allergens, allergens_reviewed)
       VALUES ($1, 'live', $2, '["general"]'::jsonb, '[]'::jsonb, true)`,
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
      senderId: uniqueTestId("brix-sync-sender"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{ id: runId, brand, flavor, casesNeeded: 1, seeded: false }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [runId]: {
            casesNeeded: 1,
            casesPerSkid: 12,
            doughRecipeName: "Brix Browser Dough",
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

    operatorPage = await openAuthenticatedPage(browser, operator, webOrigin, viewport);
    managerPage = await openAuthenticatedPage(browser, manager, webOrigin, viewport);
    for (const [page, label] of [
      [operatorPage.page, "operator"],
      [managerPage.page, "manager"],
    ] as const) {
      page.on("response", (response) => {
        try {
          const pathname = new URL(response.url()).pathname;
          if (pathname.startsWith("/api/qc/")) {
            browserEvidence.push(`${label} ${response.request().method()} ${pathname} ${response.status()}`);
          }
        } catch {
          // Ignore non-URL responses.
        }
      });
      page.on("pageerror", (error) => browserEvidence.push(`${label} pageerror ${error.message.slice(0, 160)}`));
    }

    await openQc(managerPage.page);
    await expect(managerPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    const managerBrixTab = managerPage.page.getByTestId("tab-qc-brix");
    await managerBrixTab.focus();
    await expect(managerBrixTab).toBeFocused();
    await managerPage.page.keyboard.press("Enter");
    await managerPage.page.getByLabel("Brix target ingredient").selectOption({ label: ingredientName });
    await managerPage.page.getByLabel("Target Brix (°Bx)").fill("7.5");
    await managerPage.page.getByLabel("Brix tolerance (°Bx)").fill("0.2");
    await managerPage.page.getByLabel("Brix target review reason").fill("Fixture manager-reviewed reference");
    const targetResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/brix-targets")
      && response.request().method() === "POST");
    await managerPage.page.getByTestId("button-save-brix-target").click();
    expect((await targetResponsePromise).status()).toBe(201);
    await expect(managerPage.page.getByRole("status").filter({ hasText: "Brix target change saved" })).toBeVisible();
    await expect(managerPage.page.getByText(/7\.5 °Bx ±0\.2 °Bx · manager reviewed/)).toBeVisible();

    await openQc(operatorPage.page);
    await expect(operatorPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    const operatorBrixTab = operatorPage.page.getByTestId("tab-qc-brix");
    await operatorBrixTab.focus();
    await expect(operatorBrixTab).toBeFocused();
    await operatorPage.page.keyboard.press("Enter");
    await expect(operatorPage.page.getByTestId("select-brix-ingredient")).toBeVisible();
    await expect(operatorPage.page.getByTestId("button-save-brix-target")).toHaveCount(0);
    await operatorPage.page.getByTestId("select-brix-ingredient").selectOption({ label: ingredientName });
    await expect(operatorPage.page.getByText("Reviewed target 7.5 °Bx · tolerance ±0.2 °Bx")).toBeVisible();
    const brixEntry = operatorPage.page.getByTestId("button-record-brix-check").locator("..");
    const entryBounds = await brixEntry.boundingBox();
    expect(entryBounds, "Brix entry controls are visible in the selected browser viewport").not.toBeNull();
    expect(entryBounds!.x).toBeGreaterThanOrEqual(0);
    expect(entryBounds!.x + entryBounds!.width).toBeLessThanOrEqual((viewport?.width ?? 1440) + 1);
    await operatorPage.page.getByLabel("Brix timing").selectOption("pre-run");
    await operatorPage.page.getByLabel("Brix station").selectOption("sauce");
    const actualBrixInput = operatorPage.page.getByLabel("Actual Brix (°Bx)");
    await actualBrixInput.focus();
    await expect(actualBrixInput).toBeFocused();
    await operatorPage.page.keyboard.press("Tab");
    await expect(operatorPage.page.getByLabel("Instrument (optional)")).toBeFocused();
    await operatorPage.page.keyboard.press("Shift+Tab");
    await expect(actualBrixInput).toBeFocused();
    await actualBrixInput.fill("7.3");
    await operatorPage.page.getByLabel("Instrument (optional)").fill("QC-REF-01");
    await operatorPage.page.getByLabel("Brix note (optional)").fill("Boundary reading fixture");
    const recordResponsePromise = operatorPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/brix-checks")
      && response.request().method() === "POST");
    const recordBrixButton = operatorPage.page.getByTestId("button-record-brix-check");
    await recordBrixButton.focus();
    await expect(recordBrixButton).toBeFocused();
    await operatorPage.page.keyboard.press("Enter");
    const recordResponse = await recordResponsePromise;
    expect(recordResponse.status()).toBe(201);
    const recordBody = await recordResponse.json() as {
      event: { id: number; payload: Record<string, unknown> };
    };
    const checkId = recordBody.event.id;
    expect(recordBody.event.payload).toMatchObject({
      actualBrix: 7.3,
      targetBrix: 7.5,
      toleranceBrix: 0.2,
      outcome: "pass",
      unit: "brix",
      checkType: "pre-run",
      instrument: "QC-REF-01",
    });
    expect(typeof recordBody.event.payload.targetVersion).toBe("number");
    await expect(operatorPage.page.getByRole("status").filter({ hasText: "Brix reading saved" })).toBeVisible();
    const savedEvent = operatorPage.page.getByTestId(`qc-history-event-${checkId}`);
    await expect(savedEvent).toBeVisible();
    await savedEvent.locator("button").first().click();
    await expect(savedEvent.getByTestId(`qc-brix-history-${checkId}`)).toContainText("7.3 °Bx");
    await expect(savedEvent).toContainText("pass");

    await operatorPage.page.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(operatorPage.page);
    await expect(operatorPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    await expect(operatorPage.page.getByTestId(`qc-history-event-${checkId}`)).toBeVisible();
    expect(await operatorPage.page.getByTestId("button-save-brix-target").count()).toBe(0);

    await managerPage.page.reload({ waitUntil: "domcontentloaded" });
    await managerPage.page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openQc(managerPage.page);
    await expect(managerPage.page.getByTestId("text-qc-run-id")).toHaveText(runId);
    const firstSignoffPromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/run-signoffs")
      && response.request().method() === "POST");
    await managerPage.page.getByRole("button", { name: "Sign off reviewed set", exact: true }).click();
    const firstSignoffResponse = await firstSignoffPromise;
    expect(firstSignoffResponse.status()).toBe(201);
    signoffStatuses.push(firstSignoffResponse.status());
    await expect(managerPage.page.getByText("Signed off", { exact: true })).toBeVisible();

    await managerPage.page.getByTestId("tab-qc-brix").click();
    await managerPage.page.getByTestId("select-brix-ingredient").selectOption({ label: ingredientName });
    await managerPage.page.getByLabel("Brix timing").selectOption("interval");
    await managerPage.page.getByLabel("Brix station").selectOption("sauce");
    await managerPage.page.getByLabel("Actual Brix (°Bx)").fill("7.8");
    await managerPage.page.getByLabel("Instrument (optional)").fill("QC-REF-02");
    const intervalResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/brix-checks")
      && response.request().method() === "POST");
    await managerPage.page.getByTestId("button-record-brix-check").click();
    const intervalResponse = await intervalResponsePromise;
    expect(intervalResponse.status()).toBe(201);
    const intervalBody = await intervalResponse.json() as {
      event: { id: number; payload: Record<string, unknown> };
    };
    expect(intervalBody.event.payload.outcome).toBe("fail");
    const intervalEvent = managerPage.page.getByTestId(`qc-history-event-${intervalBody.event.id}`);
    await intervalEvent.locator("button").first().click();
    await expect(intervalEvent).toContainText("fail");
    await expect(managerPage.page.getByText("Reopened", { exact: true })).toBeVisible();
    await intervalEvent.getByLabel("Correction reason").fill("Correct the fixture reading");
    await intervalEvent.getByLabel("Replacement payload JSON").fill(JSON.stringify({ actualBrix: 7.6 }));
    const correctionResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().includes(`/api/qc/events/${intervalBody.event.id}/corrections`)
      && response.request().method() === "POST");
    await intervalEvent.getByRole("button", { name: "Append correction", exact: true }).click();
    const correctionResponse = await correctionResponsePromise;
    expect(correctionResponse.status()).toBe(201);
    correctionStatus = correctionResponse.status();
    await expect(intervalEvent).toContainText("Corrected");
    await expect(intervalEvent).toContainText("pass");
    await intervalEvent.getByLabel("Redaction reason").fill("Remove the optional instrument label");
    await intervalEvent.getByRole("checkbox", { name: "Instrument", exact: true }).check();
    const redactionResponsePromise = managerPage.page.waitForResponse((response) =>
      response.url().includes(`/api/qc/events/${intervalBody.event.id}/redactions`)
      && response.request().method() === "POST");
    await intervalEvent.getByRole("button", { name: "Append redaction", exact: true }).click();
    const redactionResponse = await redactionResponsePromise;
    expect(redactionResponse.status()).toBe(201);
    redactionStatus = redactionResponse.status();
    await expect(intervalEvent).toContainText("Instrument redacted");
    await expect(managerPage.page.getByText("Reopened", { exact: true })).toBeVisible();
    const finalSignoffPromise = managerPage.page.waitForResponse((response) =>
      response.url().endsWith("/api/qc/run-signoffs")
      && response.request().method() === "POST");
    await managerPage.page.getByRole("button", { name: /Sign off reviewed set/ }).click();
    const finalSignoffResponse = await finalSignoffPromise;
    expect(finalSignoffResponse.status()).toBe(201);
    signoffStatuses.push(finalSignoffResponse.status());
    await expect(managerPage.page.getByText("Signed off", { exact: true })).toBeVisible();

    const downloadPromise = managerPage.page.waitForEvent("download");
    const exportResponsePromise = managerPage.page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/qc/history.csv"
      && response.request().method() === "GET");
    await managerPage.page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const [download, exportResponse] = await Promise.all([downloadPromise, exportResponsePromise]);
    expect(exportResponse.status()).toBe(200);
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("The Brix CSV download did not produce a readable file.");
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(downloadPath, "utf8");
    expect(csv).toContain(runId);
    expect(csv).toContain("brix-check");
    expect(csv).toContain("7.6");
    exportSummary = "manager CSV includes run-linked Brix check and corrected reading";

    const persistedRows = await db.query<{ event_type: string; count: number }>(
      `SELECT event_type, count(*)::int AS count
       FROM qc_workflow_events
       WHERE scope = 'live' AND (run_id = $1 OR profile_key = $2)
       GROUP BY event_type`,
      [runId, profileKey],
    );
    expect(persistedRows.rows.some((row) => row.event_type === "brix-check")).toBe(true);
    expect(persistedRows.rows.some((row) => row.event_type === "target-setting")).toBe(true);

    const browserEvidenceArtifact = {
        capturedAt: new Date().toISOString(),
        revision: process.env.QC_BRIX_REVISION ?? null,
        worktreeDiffSha256: process.env.QC_BRIX_WORKTREE_DIFF_SHA256 ?? null,
        environment: "fresh local disposable browser_e2e PostgreSQL",
        data: "synthetic fixtures only",
        viewport: viewport ?? { width: 1440, height: 900 },
        browser: testInfo.project.name,
        runId,
        operatorCapabilities: ["record-qc"],
        managerCapabilities: ["record-qc", "manage-qc"],
        recordStatus: recordResponse.status(),
        correctionStatus,
        redactionStatus,
        signoffStatuses,
        persistedRows: persistedRows.rows,
        exportSummary,
        apiResponses: browserEvidence,
        noCredentialsOrRequestBodies: true,
      };
    const evidenceJson = `${JSON.stringify(browserEvidenceArtifact, null, 2)}\n`;
    await testInfo.attach("qc-brix-browser-evidence.json", {
      body: Buffer.from(evidenceJson),
      contentType: "application/json",
    });
    if (process.env.QC_BRIX_EVIDENCE_DIR) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(process.env.QC_BRIX_EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(process.env.QC_BRIX_EVIDENCE_DIR, `${testInfo.project.name}.json`),
        evidenceJson,
        { mode: 0o600 },
      );
    }
  } finally {
    await operatorPage?.context.close().catch(() => {});
    await managerPage?.context.close().catch(() => {});
    await db.query(
      `DELETE FROM qc_workflow_events
       WHERE scope = 'live' AND (run_id = $1 OR profile_key = $2)`,
      [runId, profileKey],
    ).catch(() => {});
    await db.query("DELETE FROM ingredients WHERE scope = 'live' AND id = $1", [ingredientId]).catch(() => {});
    await db.end().catch(() => {});
    await fixtures.cleanup({ profileKeys: [profileKey], syncDates: [date] });
  }
});
