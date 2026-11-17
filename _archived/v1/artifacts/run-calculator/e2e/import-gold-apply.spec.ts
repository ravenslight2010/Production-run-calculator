import { expect, test, type Page, type Playwright } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import * as XLSX from "xlsx";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const API_BASE = requireLocalFixtureApiOrigin("Import Gold Apply browser journey");
const PASSWORD = "GoldApplyTest123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const GOLD_CAPTURE_ENABLED =
  process.env.IMPORT_GOLD_ENABLED === "true" &&
  process.env.IMPORT_GOLD_SOURCE_USE_APPROVED === "true" &&
  process.env.IMPORT_GOLD_RETENTION_APPROVED === "true";

type ImportKind = "spec" | "premix" | "cheese";
type ListedCase = {
  id: number;
  importType: ImportKind;
  sourceLabel: string;
  scores?: Array<{ id: number; provider: string; status: string }>;
};
const LIVE_LOCAL_SCORER = process.env.IMPORT_GOLD_LOCAL_LIVE === "true";

function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function specWorkbook(brand: string, flavor: string): Buffer {
  return workbookBuffer([{
    name: "Profiles",
    rows: [
      ["Brand", "Flavor", "Die Type", "Sauce oz/pizza", "Dough Recipe", "Sauce Recipe"],
      [brand, flavor, "12 inch", 0.5, "Synthetic Dough", "Synthetic Sauce"],
    ],
  }]);
}

function premixWorkbook(brand: string, flavor: string): Buffer {
  return workbookBuffer([{
    name: "Premix",
    rows: [
      [`${brand} ${flavor} Blend Mix`, "", "", "# OF MIXES"],
      ["", "Per Pizza", "Per Batch", "1"],
      ["Mozzarella", "1", "10"],
      ["TOTAL", "1", "10"],
    ],
  }]);
}

function cheeseWorkbook(brand: string, recipeName: string): Buffer {
  return workbookBuffer([{
    name: brand,
    rows: [
      [`${brand} Cheese`],
      ["Cheese Shredder Setting: #1"],
      [`All Varieties: ${recipeName}`],
      [],
      [recipeName],
      ["", "LBS"],
      ["Mozzarella", "10"],
      ["Total", "10"],
    ],
  }]);
}

function shippingGuideWorkbook(brand: string): Buffer {
  return workbookBuffer([{
    name: "Shipping Guide",
    rows: [
      ["PIZZA", "BOX", "CIRCLE", "PIZZAS/CS", "CASES", "GRIPSHEETS", "STACKING"],
      [brand, '12" shipper', "12 inch", 16, 40, "N/A", "Column"],
    ],
  }]);
}

function sauceGuideWorkbook(brand: string): Buffer {
  return workbookBuffer([{
    name: "Sauce Guide",
    rows: [[`${brand} uses Guide Sauce on all varieties at 0.75oz`]],
  }]);
}

function doughGuideWorkbook(brand: string): Buffer {
  return workbookBuffer([{
    name: "Dough Guide",
    rows: [
      ["Pizza to Dough Recipes"],
      [`${brand} (all) = Guide Dough`],
    ],
  }]);
}

function scheduleWorkbook(brand: string, flavor: string, date: string): Buffer {
  return workbookBuffer([{
    name: "Weekly Plan",
    rows: [
      ["Friday - Day", date, "Brand", "Flavor", "Units", "Customer", "Ship", "PO"],
      ["", "", brand, flavor, 3, "Synthetic Customer", "2030-03-16", "SYN-PO-1"],
    ],
  }]);
}

async function settingsDialog(page: Page) {
  let settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  if (!(await settings.isVisible().catch(() => false))) {
    await page.locator('button[title="More"]').click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  }
  await expect(settings).toBeVisible();
  return settings;
}

async function uploadFromSettings(
  page: Page,
  category: "Import" | "Mix Recipes" | "Cheese",
  buttonName: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  const settings = await settingsDialog(page);
  const section = category === "Import" ? "Tools" : "Recipes";
  await settings.getByRole("button", { name: section, exact: true }).click();
  await settings.getByRole("button", { name: category, exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: buttonName, exact: true }).click();
  await (await chooser).setFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
}

async function applyProfileGuide(
  page: Page,
  options: {
    buttonName: string;
    dialogTestId: string;
    confirmTestId: string;
    fileName: string;
    buffer: Buffer;
    expectedText: string;
  },
): Promise<void> {
  await uploadFromSettings(page, "Import", options.buttonName, options.fileName, options.buffer);
  const dialog = page.getByTestId(options.dialogTestId);
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText(options.expectedText, { timeout: 20_000 });
  await expect(dialog).toContainText("1 of 1 row will apply");
  const acknowledge = dialog.getByRole("checkbox", { name: /I reviewed the changes/ });
  if (await acknowledge.count()) await acknowledge.check();
  const confirm = dialog.getByTestId(options.confirmTestId);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const safety = page.getByTestId("dialog-import-safety-review");
  await expect(safety).toBeVisible({ timeout: 20_000 });
  await safety.getByTestId("button-import-safety-confirm").click();
  await expect(safety).toBeHidden();
  await expect(dialog).toBeHidden();
}

async function openImportGoldLab(page: Page) {
  const settings = await settingsDialog(page);
  await settings.getByRole("button", { name: "Settings", exact: true }).click();
  await settings.getByRole("button", { name: "Data Health & Audit", exact: true }).click();
  const lab = settings.getByTestId("import-gold-lab");
  await expect(lab).toBeVisible({ timeout: 15_000 });
  await expect(lab.getByText("Import Gold Lab", { exact: true })).toBeVisible();
  return lab;
}

async function listCases(
  request: APIRequestContext,
  cookieHeader: { Cookie: string },
): Promise<ListedCase[]> {
  const response = await request.get(`${API_BASE}/api/import-gold/cases`, {
    headers: cookieHeader,
  });
  expect(response.status()).toBe(200);
  return (await response.json() as { cases: ListedCase[] }).cases;
}

async function runSyntheticLocalScoringJourney(
  page: Page,
  playwright: Playwright,
  expectedScore: "unavailable" | "scored",
): Promise<void> {
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const api = await playwright.request.newContext();
  let accountToken: string | undefined;
  let syntheticCaseId: number | undefined;

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_synthetic"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    accountToken = account.token;
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.context().addCookies([{
      name: "rc_auth",
      value: account.token,
      url: new URL(page.url()).origin,
    }]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const lab = await openImportGoldLab(page);
    await expect(lab.getByText(/Real-source Import Gold capture and scoring remain disabled/)).toBeVisible();
    const scoringSwitch = lab.getByRole("checkbox", {
      name: "Enable local scoring in this development workspace",
    });
    await expect(scoringSwitch).not.toBeChecked();
    await scoringSwitch.click();
    await expect(scoringSwitch).toBeChecked();
    await expect(lab.getByText(/App scoring access is enabled/)).toBeVisible();
    await expect(lab.getByText(
      expectedScore === "scored" ? /configured; available/ : /configured; unavailable/,
    )).toBeVisible();

    const review = lab.getByTestId("import-gold-synthetic-review");
    await expect(review.locator("pre").first()).toContainText("Synthetic Sample Mix");
    await expect(review.locator("pre").nth(1)).toContainText("Synthetic Sample Mix");
    await expect(review.getByText(/creates an evaluation case only/)).toBeVisible();
    await review.getByRole("checkbox", { name: "I reviewed this synthetic sample and expected result" }).check();
    const applyResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/import-gold/synthetic-apply"),
    );
    await review.getByRole("button", { name: "Apply synthetic sample" }).click();
    const applyResponse = await applyResponsePromise;
    expect([200, 201]).toContain(applyResponse.status());
    syntheticCaseId = (await applyResponse.json() as { caseId: number }).caseId;
    const cookieHeader = { Cookie: `rc_auth=${account.token}` };
    const cases = await listCases(api, cookieHeader);
    expect(cases).toContainEqual(expect.objectContaining({
      id: syntheticCaseId,
      importType: "premix",
      sourceLabel: "Synthetic local scoring fixture",
    }));

    const scoreResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/import-gold/score"),
    );
    await lab.getByRole("button", { name: "Score locally" }).click();
    const scoreResponse = await scoreResponsePromise;
    expect(scoreResponse.status()).toBe(200);
    const scoreBody = await scoreResponse.json() as {
      scoredCount: number;
      errorCount: number;
      results: Array<{
        caseId: number;
        provider: string;
        status: string;
        scoreId: number;
        accuracy?: number;
        errorCode?: string;
      }>;
    };
    const caseCard = lab.getByTestId(`import-gold-case-${syntheticCaseId}`);
    if (expectedScore === "unavailable") {
      expect(scoreBody).toMatchObject({ scoredCount: 0, errorCount: 1 });
      await expect(caseCard.getByText("local: error: provider_unavailable", { exact: true })).toBeVisible();
      await expect(lab.getByRole("alert")).toContainText("1 score attempt failed");
    } else {
      const safeCodes = new Set(["provider_not_configured", "invalid_output", "provider_unavailable"]);
      const failureCodes = scoreBody.results
        .filter((result) => result.caseId === syntheticCaseId && result.provider === "local" && result.status === "error")
        .map((result) => result.errorCode && safeCodes.has(result.errorCode) ? result.errorCode : "unclassified");
      expect(scoreBody, `safe local scorer error codes: ${failureCodes.join(",") || "none"}`)
        .toMatchObject({ scoredCount: 1, errorCount: 0 });
      const score = scoreBody.results.find((result) =>
        result.caseId === syntheticCaseId && result.provider === "local",
      );
      expect(score).toMatchObject({ status: "scored" });
      expect(score?.accuracy).toBeGreaterThanOrEqual(0);
      expect(score?.accuracy).toBeLessThanOrEqual(100);
      const storedCase = (await listCases(api, { Cookie: `rc_auth=${account.token}` }))
        .find((item) => item.id === syntheticCaseId);
      expect(storedCase?.scores).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: score?.scoreId, provider: "local", status: "scored" }),
      ]));
      await expect(caseCard).toContainText(/local: \d+(?:\.\d+)?% \(\d+\/\d+\)/);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const reloadedLab = await openImportGoldLab(page);
    await expect(reloadedLab.getByRole("checkbox", {
      name: "Enable local scoring in this development workspace",
    })).toBeChecked();
    const reloadedCase = reloadedLab.getByTestId(`import-gold-case-${syntheticCaseId}`);
    if (expectedScore === "unavailable") {
      await expect(reloadedCase.getByText("local: error: provider_unavailable", { exact: true })).toBeVisible();
    } else {
      await expect(reloadedCase).toContainText(/local: \d+(?:\.\d+)?% \(\d+\/\d+\)/);
    }
    await expect(reloadedLab.getByRole("button", { name: "Compare with Gemini" })).toHaveCount(0);
  } finally {
    if (accountToken) {
      const cookieHeader = { Cookie: `rc_auth=${accountToken}` };
      if (syntheticCaseId !== undefined) {
        await api.delete(`${API_BASE}/api/import-gold/cases/${syntheticCaseId}`, { headers: cookieHeader }).catch(() => {});
      }
      await api.patch(`${API_BASE}/api/import-gold/local-scoring`, {
        headers: cookieHeader,
        data: { enabled: false },
      }).catch(() => {});
    }
    await api.dispose();
    await fixtures.cleanup();
  }
}

test("development-only synthetic local scoring retains a safe unavailable result", async ({
  page,
  playwright,
}) => {
  test.skip(LIVE_LOCAL_SCORER, "Use the live-evaluator journey when IMPORT_GOLD_LOCAL_LIVE=true.");
  test.setTimeout(120_000);
  await runSyntheticLocalScoringJourney(page, playwright, "unavailable");
});

test("development-only synthetic local scoring persists a score from the private evaluator", async ({
  page,
  playwright,
}) => {
  test.skip(!LIVE_LOCAL_SCORER, "Requires the private evaluator and IMPORT_GOLD_LOCAL_LIVE=true.");
  test.setTimeout(240_000);
  await runSyntheticLocalScoringJourney(page, playwright, "scored");
});

async function applyFromReview(
  page: Page,
  kind: ImportKind,
  optInTestId: string,
  applyButton: RegExp,
): Promise<void> {
  const optIn = page.getByTestId(optInTestId);
  await expect(optIn).toBeVisible();
  await optIn.check();
  const responsePromise = page.waitForResponse((response) =>
    /\/api\/import-operations\/[^/]+\/apply$/.test(response.url()),
  );
  await page.getByRole("button", { name: applyButton }).click();
  const response = await responsePromise;
  expect(response.status(), `${kind} human Apply should be accepted`).toBe(200);
  await expect(page.getByTestId(optInTestId)).toBeHidden();
  const closeSettings = page.getByRole("button", { name: "Close settings", exact: true });
  if (await closeSettings.isVisible().catch(() => false)) {
    await closeSettings.click();
  }
}

async function applyWithoutGoldCapture(
  page: Page,
  optInTestId: string,
  applyButton: RegExp,
  importType: ImportKind,
): Promise<void> {
  await expect(page.getByTestId(optInTestId)).toHaveCount(0);
  const observed: Array<{ phase: "request" | "response"; method: string; path: string; status?: number }> = [];
  const safePath = (url: string) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/api/import-operations/preview") return pathname;
    return pathname.replace(/^\/api\/import-operations\/[^/]+/, "/api/import-operations/:operationId");
  };
  const onRequest = (request: import("@playwright/test").Request) => {
    if (!new URL(request.url()).pathname.startsWith("/api/import-operations/")) return;
    observed.push({ phase: "request", method: request.method(), path: safePath(request.url()) });
  };
  const onResponse = (response: import("@playwright/test").Response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/import-operations/")) return;
    observed.push({
      phase: "response",
      method: response.request().method(),
      path: safePath(response.url()),
      status: response.status(),
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const apply = page.getByRole("button", { name: applyButton });
    const safety = page.getByTestId("dialog-import-safety-review");
    let hasSafetyReview = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const previewPromise = page.waitForResponse((candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/import-operations/preview",
      { timeout: 30_000 });
      await apply.click();
      const preview = await previewPromise;
      expect(preview.status(), "The reviewed import preview should be accepted").toBe(200);
      if (await safety.isVisible().catch(() => false)) {
        hasSafetyReview = true;
        break;
      }
      const refreshed = await page.getByText(
        "Nothing was saved. The current recipe library changed this review; check the updated changes below and confirm again.",
        { exact: true },
      ).isVisible().catch(() => false);
      if (attempt === 0 && refreshed) {
        await expect(apply).toBeEnabled();
        continue;
      }
      await expect(safety).toBeVisible({ timeout: 10_000 });
      hasSafetyReview = true;
      break;
    }
    expect(hasSafetyReview, `${importType} Apply requires explicit confirmation of the server preview`).toBe(true);
    const applyPromise = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" &&
      /^\/api\/import-operations\/[^/]+\/apply$/.test(new URL(candidate.url()).pathname),
    { timeout: 30_000 });
    await safety.getByTestId("button-import-safety-confirm").click();
    const response = await applyPromise;
    await expect(safety).toBeHidden();
    expect(response.status(), `${importType} Apply should succeed without Gold capture`).toBe(200);
    const applyBody = response.request().postDataJSON() as Record<string, unknown>;
    expect(Object.hasOwn(applyBody, "goldCapture")).toBe(false);
  } catch (error) {
    console.log("ordinary-import-apply-diagnostic", JSON.stringify({ importType, observed }));
    throw error;
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
  const closeSettings = page.getByRole("button", { name: "Close settings", exact: true });
  if (await closeSettings.isVisible().catch(() => false)) {
    await closeSettings.click();
  }
}

test("opted-in spec, premix, and cheese cases appear after Apply and manager reload", async ({
  page,
  playwright,
}) => {
  test.skip(!GOLD_CAPTURE_ENABLED, "Run with the synthetic Import Gold test gates enabled.");
  test.setTimeout(180_000);

  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const api = await playwright.request.newContext();
  const suffix = uniqueTestId("g");
  const brand = `Gold ${suffix}`;
  const flavor = "Classic";
  const specName = `gold-spec-${suffix}.xlsx`;
  const premixName = `gold-premix-${suffix}.xlsx`;
  const cheeseName = `gold-cheese-${suffix}.xlsx`;
  const failedSpecName = `gold-failed-spec-${suffix}.xlsx`;
  const interceptedAiPaths: string[] = [];
  let appliedCaseIds = new Set<number>();
  let failedApplyMutationApplied = false;
  let accountToken: string | undefined;
  let initialIds: Set<number> | undefined;

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_gold_apply"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES.filter((capability) => capability !== "use-ai-tools"),
      onboardingSeen: true,
    });
    accountToken = account.token;
    // Keep every AI route inside the browser fixture. The deterministic spec
    // workbook needs no model, and any optional name-match request gets a
    // synthetic empty response rather than reaching a provider.
    await page.context().route("**/api/ai/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      interceptedAiPaths.push(path);
      if (path === "/api/ai/match-premix") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ matches: [], generatedAt: 0, decision: "suggestion" }),
        });
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "AI endpoints are disabled in this test." }),
      });
    });

    // Force one genuine server-side Apply rejection before its transaction
    // starts, while keeping the rest of the reviewed request unchanged.
    await page.context().route("**/api/import-operations/*/apply", async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.importType === "spec" && payload.sourceLabel === failedSpecName) {
        failedApplyMutationApplied = true;
        const rejectedPayload = {
          ...payload,
          goldCapture: { input: {} },
        };
        await route.continue({ postData: JSON.stringify(rejectedPayload) });
        return;
      }
      await route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.context().addCookies([{
      name: "rc_auth",
      value: account.token,
      url: new URL(page.url()).origin,
    }]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const cookieHeader = account.cookieHeader;
    const initialCases = await listCases(api, cookieHeader);
    initialIds = new Set(initialCases.map((item) => item.id));
    appliedCaseIds = new Set(initialIds);

    await uploadFromSettings(
      page,
      "Import",
      "Import Spec Sheet",
      specName,
      specWorkbook(brand, flavor),
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await applyFromReview(page, "spec", "spec-import-gold-opt-in", /Apply \d+ item/);

    const cheeseRecipe = `${brand} Classic Cheese Mix`;
    await uploadFromSettings(
      page,
      "Mix Recipes",
      "Import Premix Sheet",
      premixName,
      premixWorkbook(brand, flavor),
    );
    await expect(page.getByTestId("premix-import-gold-opt-in")).toBeVisible({ timeout: 20_000 });
    await applyFromReview(page, "premix", "premix-import-gold-opt-in", /Apply \d+ mix/);

    await uploadFromSettings(
      page,
      "Cheese",
      "Import Cheese Mix Recipe Specs",
      cheeseName,
      cheeseWorkbook(brand, cheeseRecipe),
    );
    await expect(page.getByTestId("cheese-import-gold-opt-in")).toBeVisible({ timeout: 20_000 });
    await applyFromReview(page, "cheese", "cheese-import-gold-opt-in", /Apply \d+ recipe/);

    const afterSuccessfulApplies = await listCases(api, cookieHeader);
    const newCases = afterSuccessfulApplies.filter((item) => !initialIds.has(item.id));
    expect(newCases.map((item) => item.importType).sort()).toEqual(["cheese", "premix", "spec"]);
    appliedCaseIds = new Set(afterSuccessfulApplies.map((item) => item.id));

    const lab = await openImportGoldLab(page);
    for (const item of newCases) {
      await expect(lab.getByTestId(`import-gold-case-${item.id}`)).toContainText(item.sourceLabel);
      await expect(lab.getByTestId(`import-gold-case-${item.id}`)).toContainText(
        new RegExp(item.importType, "i"),
      );
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const reloadedLab = await openImportGoldLab(page);
    for (const item of newCases) {
      await expect(reloadedLab.getByTestId(`import-gold-case-${item.id}`)).toContainText(item.sourceLabel);
      await expect(reloadedLab.getByTestId(`import-gold-case-${item.id}`)).toContainText(
        new RegExp(item.importType, "i"),
      );
    }

    await uploadFromSettings(
      page,
      "Import",
      "Import Spec Sheet",
      failedSpecName,
      specWorkbook(`Failed Bakery ${suffix}`, flavor),
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTestId("spec-import-gold-opt-in")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("spec-import-gold-opt-in").check();
    const failedApply = page.waitForResponse((response) =>
      /\/api\/import-operations\/[^/]+\/apply$/.test(response.url()),
    );
    await page.getByRole("button", { name: /Apply \d+ item/ }).click();
    const failedResponse = await failedApply;
    expect(failedApplyMutationApplied).toBe(true);
    expect(failedResponse.status()).toBe(400);
    await expect(
      page.getByRole("dialog", { name: "Import Spec Sheet" }).getByText("Invalid gold input shape"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
    const afterFailedApply = await listCases(api, cookieHeader);
    expect(new Set(afterFailedApply.map((item) => item.id))).toEqual(appliedCaseIds);
    const finalLab = await openImportGoldLab(page);
    for (const item of newCases) {
      await expect(finalLab.getByTestId(`import-gold-case-${item.id}`)).toBeVisible();
    }
    await expect(finalLab.getByText(failedSpecName)).toHaveCount(0);
    await expect(finalLab.getByText(/No cases have been captured yet/)).toHaveCount(0);
    expect(interceptedAiPaths).not.toContain("/api/ai/parse-spec");
    expect(interceptedAiPaths).not.toContain("/api/ai/parse-premix");
    expect(interceptedAiPaths).not.toContain("/api/ai/parse-cheese");
    expect(interceptedAiPaths.every((path) => path === "/api/ai/match-premix")).toBe(true);
  } finally {
    if (accountToken && initialIds) {
      const headers = { Cookie: `rc_auth=${accountToken}` };
      const remainingCases = await listCases(api, headers).catch(() => []);
      for (const item of remainingCases) {
        if (initialIds.has(item.id)) continue;
        await api.delete(`${API_BASE}/api/import-gold/cases/${item.id}`, { headers }).catch(() => {});
      }
    }
    await api.dispose();
    await fixtures.cleanup();
  }
});

test("synthetic workbook imports Apply and persist without Gold capture", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180_000);
  expect(GOLD_CAPTURE_ENABLED, "The ordinary import journey must run with Gold capture disabled").toBe(false);

  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const api = await playwright.request.newContext();
  const suffix = uniqueTestId("ordinary-import");
  // Cheese workbook customer names are worksheet names, which Excel limits to 31 characters.
  const brand = `Synthetic ${suffix.slice(-16)}`;
  const flavor = "Classic";
  const cheeseRecipe = `${brand} Classic Cheese Mix`;
  let account: Awaited<ReturnType<typeof fixtures.createAccount>> | undefined;

  try {
    account = await fixtures.createAccount({
      username: uniqueTestId("e2e_ordinary_import"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES.filter((capability) => capability !== "use-ai-tools"),
      onboardingSeen: true,
    });
    await page.context().route("**/api/ai/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/ai/match-premix") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ matches: [], generatedAt: 0, decision: "suggestion" }),
        });
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "AI endpoints are disabled in this test." }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.context().addCookies([{
      name: "rc_auth",
      value: account.token,
      url: new URL(page.url()).origin,
    }]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await uploadFromSettings(page, "Import", "Import Spec Sheet", `${suffix}-spec.xlsx`, specWorkbook(brand, flavor));
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await applyWithoutGoldCapture(page, "spec-import-gold-opt-in", /Apply \d+ item/, "spec");

    const premixRecipe = `${brand} ${flavor} Blend Mix`;
    await uploadFromSettings(
      page,
      "Mix Recipes",
      "Import Premix Sheet",
      `${suffix}-premix.xlsx`,
      premixWorkbook(brand, flavor),
    );
    await applyWithoutGoldCapture(page, "premix-import-gold-opt-in", /Apply \d+ mix/, "premix");

    await uploadFromSettings(
      page,
      "Cheese",
      "Import Cheese Mix Recipe Specs",
      `${suffix}-cheese.xlsx`,
      cheeseWorkbook(brand, cheeseRecipe),
    );
    await applyWithoutGoldCapture(page, "cheese-import-gold-opt-in", /Apply \d+ recipe/, "cheese");

    await applyProfileGuide(page, {
      buttonName: "Import Shipping & Palletizing Guide",
      dialogTestId: "dialog-shipping-import",
      confirmTestId: "button-shipping-import-confirm",
      fileName: `${suffix}-shipping.xlsx`,
      buffer: shippingGuideWorkbook(brand),
      expectedText: brand,
    });
    await applyProfileGuide(page, {
      buttonName: "Import Sauce Guide",
      dialogTestId: "dialog-sauce-guide-import",
      confirmTestId: "button-sauce-guide-import-confirm",
      fileName: `${suffix}-sauce.xlsx`,
      buffer: sauceGuideWorkbook(brand),
      expectedText: "Guide Sauce",
    });
    await applyProfileGuide(page, {
      buttonName: "Import Dough Recipe Guide",
      dialogTestId: "dialog-dough-guide-import",
      confirmTestId: "button-dough-guide-import-confirm",
      fileName: `${suffix}-dough.xlsx`,
      buffer: doughGuideWorkbook(brand),
      expectedText: "Guide Dough",
    });
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Manage Lists & Settings" })).toBeHidden();

    const scheduledDate = "2030-03-15";
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    const scheduledDays = page.getByRole("dialog", { name: "Scheduled Days" });
    await scheduledDays.getByRole("button", { name: "Schedule New Day", exact: true }).click();
    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    const [scheduleFileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      scheduleEditor.getByRole("button", { name: "Import Excel", exact: true }).click(),
    ]);
    await scheduleFileChooser.setFiles({
      name: `${suffix}-schedule.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: scheduleWorkbook(brand, flavor, scheduledDate),
    });
    const scheduleImport = page.getByRole("dialog", { name: "Import Excel" });
    await expect(scheduleImport).toContainText(`${brand} · ${flavor} · 3 cases · ${scheduledDate}`);
    await expect(scheduleImport).toContainText("1 run across 1 day");
    const confirmSchedule = scheduleImport.getByTestId("button-excel-import-confirm");
    await expect(confirmSchedule).toBeEnabled();
    await confirmSchedule.click();

    const scheduleSafety = page.getByTestId("dialog-import-safety-review");
    await expect(scheduleSafety).toBeVisible({ timeout: 20_000 });
    await expect(scheduleSafety).toContainText(scheduledDate);
    const scheduleWrite = page.waitForResponse((response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === `/api/sync/${scheduledDate}`,
    { timeout: 30_000 });
    await scheduleSafety.getByTestId("button-import-safety-confirm").click();
    const scheduleWriteResponse = await scheduleWrite;
    expect(scheduleWriteResponse.status(), "Schedule date should be acknowledged independently").toBe(200);
    await expect(scheduleSafety).toBeHidden();
    await expect(scheduleImport).toBeHidden();

    const uncertainDate = "2030-03-16";
    let serverAcknowledgedUncertainWrite = false;
    let uncertainPutRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === `/api/sync/${uncertainDate}`
      ) uncertainPutRequests += 1;
    });
    await page.route(
      (url) => url.pathname === `/api/sync/${uncertainDate}`,
      async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        serverAcknowledgedUncertainWrite = response.status() === 200;
        await route.abort("failed");
      },
    );
    const [uncertainFileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      scheduleEditor.getByRole("button", { name: "Import Excel", exact: true }).click(),
    ]);
    await uncertainFileChooser.setFiles({
      name: `${suffix}-schedule-uncertain.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: scheduleWorkbook(brand, flavor, uncertainDate),
    });
    const uncertainImport = page.getByRole("dialog", { name: "Import Excel" });
    await expect(uncertainImport).toContainText(`${brand} · ${flavor} · 3 cases · ${uncertainDate}`);
    await uncertainImport.getByTestId("button-excel-import-confirm").click();
    const uncertainSafety = page.getByTestId("dialog-import-safety-review");
    await expect(uncertainSafety).toBeVisible({ timeout: 20_000 });
    const partialHistoryResponse = page.waitForResponse((response) => {
      if (
        response.request().method() !== "POST" ||
        new URL(response.url()).pathname !== "/api/import-history"
      ) return false;
      try {
        const body = response.request().postDataJSON() as { importType?: string; status?: string };
        return body.importType === "schedule" && body.status === "partial";
      } catch {
        return false;
      }
    }, { timeout: 30_000 });
    await uncertainSafety.getByTestId("button-import-safety-confirm").click();
    const partialHistory = await partialHistoryResponse;
    expect(partialHistory.status()).toBe(201);
    const partialHistoryBody = await partialHistory.json() as {
      import?: {
        status?: string;
        sourceKey?: string | null;
        summary?: {
          counts?: Record<string, number>;
          landed?: Record<string, number>;
          followUp?: string[];
        };
      };
    };
    expect(serverAcknowledgedUncertainWrite).toBe(true);
    expect(uncertainPutRequests).toBe(1);
    expect(partialHistoryBody.import?.status).toBe("partial");
    expect(partialHistoryBody.import?.sourceKey).toBeTruthy();
    expect(partialHistoryBody.import?.summary?.counts).toMatchObject({
      requestedDays: 1,
      confirmedDays: 0,
      unconfirmedDays: 1,
      notSentDays: 0,
    });
    expect(partialHistoryBody.import?.summary?.landed).toEqual({});
    expect(partialHistoryBody.import?.summary?.landed?.days).toBeUndefined();
    expect(partialHistoryBody.import?.summary?.followUp?.[0]).toMatch(
      /Reload the schedule and inspect each unconfirmed date before deciding whether to retry/,
    );
    await expect(page.getByText("Schedule result not confirmed", { exact: true })).toBeVisible();
    await expect(uncertainImport).toBeHidden();
    await page.unroute((url) => url.pathname === `/api/sync/${uncertainDate}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    for (const [path, expectedName] of [
      ["/api/brand-profiles", brand],
      ["/api/mixes", premixRecipe],
      ["/api/cheese-recipes", cheeseRecipe],
    ]) {
      const response = await api.get(`${API_BASE}${path}`, { headers: account.cookieHeader });
      expect(response.status(), `Reloaded ${path} should be readable`).toBe(200);
      const body = await response.json() as {
        items?: Array<{
          brand?: string;
          flavor?: string;
          values?: Record<string, unknown>;
        }>;
      };
      expect(JSON.stringify(body)).toContain(expectedName);
      if (path === "/api/brand-profiles") {
        const profile = body.items?.find(
          (item) => item.brand === brand && item.flavor?.toLowerCase() === flavor.toLowerCase(),
        );
        expect(profile).toBeDefined();
        expect(profile?.values).toMatchObject({
          frontlineRecipeName: "Guide Sauce",
          sauceOzPerPizza: 0.75,
          doughRecipeName: "Guide Dough",
          pizzasPerCase: 16,
          casesPerSkid: 40,
        });
      }
    }
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()),
    );
    const scheduleResponse = await api.get(`${API_BASE}/api/sync/${scheduledDate}?today=${today}`, {
      headers: account.cookieHeader,
    });
    expect(scheduleResponse.status(), "Reloaded imported schedule should be readable").toBe(200);
    const savedSchedule = await scheduleResponse.json() as {
      dayState?: { runs?: Array<{ id: string; brand: string; flavor: string; imported?: boolean }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    };
    expect(savedSchedule.dayState?.runs).toHaveLength(1);
    const scheduledRun = savedSchedule.dayState?.runs?.[0];
    expect(scheduledRun).toMatchObject({ brand, flavor, imported: true });
    expect(savedSchedule.runValues?.[scheduledRun!.id]?.casesNeeded).toBe(3);

    const uncertainScheduleResponse = await api.get(`${API_BASE}/api/sync/${uncertainDate}?today=${today}`, {
      headers: account.cookieHeader,
    });
    expect(uncertainScheduleResponse.status()).toBe(200);
    const savedUncertainSchedule = await uncertainScheduleResponse.json() as {
      dayState?: { runs?: Array<{ id: string; brand: string; flavor: string; imported?: boolean }> };
      runValues?: Record<string, { casesNeeded?: number }>;
    };
    expect(uncertainPutRequests, "Reload must not retry an unconfirmed schedule write").toBe(1);
    expect(savedUncertainSchedule.dayState?.runs).toHaveLength(1);
    const uncertainRun = savedUncertainSchedule.dayState?.runs?.[0];
    expect(uncertainRun).toMatchObject({ brand, flavor, imported: true });
    expect(savedUncertainSchedule.runValues?.[uncertainRun!.id]?.casesNeeded).toBe(3);
  } finally {
    await api.dispose();
    await fixtures.cleanup();
  }
});
