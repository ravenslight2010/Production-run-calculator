import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";
import { attachVisualEvidence } from "./captureVisualEvidence";

const PASSWORD = "Task3494BrowserOnly123!";
const usernames = new Set<string>();
const runId = uniqueTestId("task3494_audit");
const BRAND = `Audit Bakery ${runId}`;
const FLAVOR = `Review Pizza ${runId}`;
const FILE = `audited-spec-${runId}.xlsx`;

function specWorkbook(): Buffer {
  const profiles = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Dough Recipe", "Sauce Recipe", "Sauce oz/pizza"],
    [BRAND, FLAVOR, 7, `Dough ${runId}`, `Sauce ${runId}`, 1.25],
  ]);
  const dough = XLSX.utils.aoa_to_sheet([
    [`Recipe: Dough ${runId}`], ["Ingredient", "lbs"], ["Flour", 50.25],
  ]);
  const sauce = XLSX.utils.aoa_to_sheet([
    [`Recipe: Sauce ${runId}`], ["Ingredient", "lbs"], ["Tomato", 3.75],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, profiles, "Production Runs");
  XLSX.utils.book_append_sheet(wb, dough, "Dough Recipe");
  XLSX.utils.book_append_sheet(wb, sauce, "Sauce Recipe");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function setManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows[0]?.id).toBeTruthy();
    await db.query(
      "INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager') " +
      "ON CONFLICT (user_id) DO UPDATE SET role = 'manager'",
      [user.rows[0]!.id],
    );
    // Keep AI capability absent: spec parsing is deterministic and no paid provider is used.
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
      [JSON.stringify(["manage-staff", "manage-inventory", "manage-profiles", "manage-factory-settings"])],
    );
  } finally { await db.end().catch(() => {}); }
}

async function openImportSection(page: Page): Promise<void> {
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();
}

async function settingsImport(page: Page): Promise<void> {
  await openImportSection(page);
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  const chooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
  await (await chooser).setFiles({
    name: FILE,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: specWorkbook(),
  });
}

test.beforeAll(async () => { await requireIsolatedTestDatabase("task3494 audited import browser pass"); });
test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try { await db.connect(); await cleanupTestUsers(db, usernames); }
  finally { await db.end().catch(() => {}); }
});

test("manager spec import is reviewed atomically before apply and survives reload/history", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "real importer journey runs once on desktop Chromium");
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  let accountPhase = "staff-onboarding";
  const inventoryStartResponses: Array<{ status: number; phase: string }> = [];
  const inventoryForbiddenResponses: Array<{ method: string; route: string; phase: string }> = [];
  const performanceWarnings: Array<{ name: string; durationMs: number; budgetMs: number }> = [];
  await page.addInitScript(() => {
    const host = window as Window & {
      __task3722PerformanceSamples?: Array<{ name: string; durationMs: number; kind: string }>;
    };
    const samples = host.__task3722PerformanceSamples = [];
    const allowed = new Set([
      "browser:navigation-to-dom-content-loaded",
      "browser:navigation-to-load",
      "startup:home-chunk-load",
      "management:review-chunk-load",
    ]);
    window.addEventListener("calculator-performance", (event) => {
      const detail = (event as CustomEvent<{
        name?: unknown;
        durationMs?: unknown;
        kind?: unknown;
      }>).detail;
      if (
        typeof detail?.name !== "string" ||
        !allowed.has(detail.name) ||
        typeof detail.durationMs !== "number" ||
        typeof detail.kind !== "string" ||
        samples.length >= 32
      ) return;
      samples.push({
        name: detail.name,
        durationMs: Math.round(detail.durationMs),
        kind: detail.kind,
      });
    });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(page.url()).origin) return;
    if (
      response.request().method() === "POST" &&
      url.pathname === "/api/inventory/consume-day-start"
    ) {
      inventoryStartResponses.push({ status: response.status(), phase: accountPhase });
    }
    if (response.status() !== 403) return;
    if (!url.pathname.startsWith("/api/inventory/") && url.pathname !== "/api/inventory") return;
    const route = url.pathname.replace(
      /\/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]{4,})(?=\/|$)/gi,
      "/:id",
    );
    inventoryForbiddenResponses.push({
      method: response.request().method(),
      route,
      phase: accountPhase,
    });
  });
  page.on("console", async (message) => {
    if (message.type() !== "warning" || !message.text().startsWith("[calculator-performance]")) return;
    const details = await message.args()[1]?.jsonValue().catch(() => null) as
      | { name?: unknown; durationMs?: unknown; budgetMs?: unknown }
      | null
      | undefined;
    if (
      typeof details?.name === "string" &&
      typeof details.durationMs === "number" &&
      typeof details.budgetMs === "number"
    ) {
      performanceWarnings.push({
        name: details.name,
        durationMs: Math.round(details.durationMs),
        budgetMs: details.budgetMs,
      });
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  // Fail closed if a provider request is attempted; this account also lacks use-ai-tools.
  await page.route(/(?:openai|anthropic|gemini|generativelanguage|googleapis)\.com/i, (route) =>
    route.abort("blockedbyclient"));
  const username = uniqueTestId("manager_task3494");
  usernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: process.env.STAFF_SIGNUP_CODE ?? "",
    waitForApp: (p) => p.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 }),
    onboarding: { visibilityTimeout: 5_000 },
  });
  accountPhase = "role-promotion";
  await setManager(username);
  accountPhase = "manager-session";
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()) as { capabilities: string[] });
  expect(me.capabilities).toEqual(expect.arrayContaining(["manage-staff", "manage-inventory", "manage-profiles"]));
  expect(me.capabilities).not.toContain("use-ai-tools");

  await settingsImport(page);
  const review = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(review).toContainText("Step 1 of 2 — products", { timeout: 30_000 });
  await review.getByRole("button", { name: "Next", exact: true }).click();
  await expect(review).toContainText("Step 2 of 2 — details");
  await expect(review).toContainText("50.25");
  await expect(review).toContainText("3.75");
  const apply = review.getByRole("button", { name: /^Apply \d+ items?$/ });
  await expect(apply).toBeEnabled();
  const applyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/import-operations/") && request.method() === "POST") {
      applyRequests.push(new URL(request.url()).pathname);
    }
  });
  const previewWait = page.waitForResponse((r) =>
    r.url().endsWith("/api/import-operations/preview") && r.request().method() === "POST");
  await apply.click();
  const preview = await previewWait;
  expect(preview.status()).toBe(200);
  const safety = page.getByTestId("dialog-import-safety-review");
  await expect(safety).toBeVisible();
  await expect(safety).toContainText("Factory recipe & profile changes");
  await expect(safety).toContainText("Source version differences");
  await expect(safety).toContainText(BRAND);
  await expect(safety).toContainText("Unknown / not supplied");
  await expect(safety.getByTestId("button-import-safety-cancel")).toBeInViewport();
  await expect(safety.getByTestId("button-import-safety-confirm")).toBeInViewport();
  await attachVisualEvidence(page, info, "task3494-spec-final-safety-review-before-cancel");
  await page.keyboard.press("Escape");
  await expect(safety).toBeHidden();
  await expect.poll(() => applyRequests.filter((p) => /\/apply$/.test(p)).length).toBe(0);
  await expect(review).toBeVisible();
  await expect(review.getByText(/server did not confirm|earlier save may have reached|unconfirmed/i)).toHaveCount(0);
  await expect(apply).toBeEnabled();
  const pendingAfterCancel = await page.evaluate(() => {
    const raw = sessionStorage.getItem("run-calculator.pending-import-operations.v1");
    return raw === null ? [] : JSON.parse(raw);
  });
  expect(pendingAfterCancel).toEqual([]);
  const historyAfterCancel = await page.evaluate(async (sourceLabel) => {
    const response = await fetch("/api/import-history?type=spec", { cache: "no-store" });
    const body = await response.json() as { imports?: Array<{ sourceLabel?: string; status?: string }> };
    return (body.imports ?? []).filter((item) => item.sourceLabel === sourceLabel && item.status === "failed");
  }, FILE);
  expect(historyAfterCancel).toEqual([]);

  // Rechecking the live recipe pools can refresh the local review before the
  // server preview. That first retry must remain a no-write confirmation step.
  await apply.click();
  await expect(review).toContainText(
    "Nothing was saved. The current recipe library changed this review; check the updated changes below and confirm again.",
  );
  expect(applyRequests.filter((path) => path.endsWith("/preview"))).toHaveLength(1);
  expect(applyRequests.filter((path) => /\/apply$/.test(path))).toHaveLength(0);
  await expect(apply).toBeEnabled();

  // Confirm the refreshed review; preview and apply remain separate requests.
  const previewWait2 = page.waitForResponse((r) =>
    r.url().endsWith("/api/import-operations/preview") && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await apply.click();
  expect((await previewWait2).status()).toBe(200);
  await expect(safety).toBeVisible();
  const applyWait = page.waitForResponse((r) =>
    /\/api\/import-operations\/[^/]+\/apply$/.test(new URL(r.url()).pathname) &&
    r.request().method() === "POST", { timeout: 10_000 });
  const confirm = safety.getByTestId("button-import-safety-confirm");
  await expect(confirm).toBeVisible();
  await confirm.click({ timeout: 5_000 });
  const applied = await applyWait;
  expect(applied.status()).toBe(200);
  await expect(safety).toBeHidden();
  expect(applyRequests.some((p) => /\/apply$/.test(p))).toBe(true);
  const saved = await page.evaluate(async ({ brand, flavor }) => {
    const r = await fetch("/api/brand-profiles", { cache: "no-store" });
    const body = await r.json() as { items: Array<{ brand: string; flavor: string; values: Record<string, unknown> }> };
    return { status: r.status, profile: body.items.find((x) => x.brand === brand && x.flavor === flavor) };
  }, { brand: BRAND, flavor: FLAVOR });
  expect(saved.status).toBe(200);
  expect(saved.profile).toBeTruthy();
  expect(saved.profile?.values.sauceOzPerPizza).toBe(1.25);
  await expect.poll(async () => page.evaluate(async (sourceLabel) => {
    const response = await fetch("/api/import-history?type=spec", { cache: "no-store" });
    const body = await response.json() as { imports?: Array<{ sourceLabel?: string; status?: string }> };
    return (body.imports ?? []).some((item) => item.sourceLabel === sourceLabel && item.status === "complete");
  }, FILE)).toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const reloaded = await page.evaluate(async ({ brand, flavor }) => {
    const body = await (await fetch("/api/brand-profiles", { cache: "no-store" })).json() as { items: Array<{ brand: string; flavor: string }> };
    return body.items.some((x) => x.brand === brand && x.flavor === flavor);
  }, { brand: BRAND, flavor: FLAVOR });
  expect(reloaded).toBe(true);

  await openImportSection(page);
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  for (const label of ["Dough", "Sauce", "Cheese", "Mixes"]) {
    await settings.getByRole("checkbox", { name: label, exact: true }).uncheck();
  }
  const downloadWait = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download Workbooks", exact: true }).click();
  const download = await downloadWait;
  expect(await download.failure()).toBeNull();
  const exportedFilename = download.suggestedFilename();
  expect(exportedFilename).toMatch(/^specs-.+\.xlsx$/);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("The spec workbook download did not produce a readable file.");
  const exportedWorkbook = await readFile(downloadPath);
  const exportedValues = Object.values(XLSX.read(exportedWorkbook, { type: "buffer" }).Sheets)
    .flatMap((sheet) => XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }).flat());
  expect(exportedValues).toContain(BRAND);
  expect(exportedValues).toContain(FLAVOR);
  expect(exportedValues.map((value) => String(value))).toContain("1.25");

  const applyCountBeforeRoundTrip = applyRequests.filter((path) => /\/apply$/.test(path)).length;
  const roundTripChooser = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
  await (await roundTripChooser).setFiles({
    name: exportedFilename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: exportedWorkbook,
  });
  const roundTripReview = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(roundTripReview).toContainText("Step 1 of 2 — products", { timeout: 30_000 });
  await roundTripReview.getByRole("button", { name: "Next", exact: true }).click();
  await expect(roundTripReview).toContainText(BRAND);
  await expect(roundTripReview).toContainText(FLAVOR);
  await expect(roundTripReview).toContainText("1.25");
  await page.keyboard.press("Escape");
  await expect(roundTripReview).toBeHidden();
  expect(applyRequests.filter((path) => /\/apply$/.test(path))).toHaveLength(applyCountBeforeRoundTrip);
  const profileAfterRoundTripPreview = await page.evaluate(async ({ brand, flavor }) => {
    const response = await fetch("/api/brand-profiles", { cache: "no-store" });
    const body = await response.json() as {
      items: Array<{ brand: string; flavor: string; values: Record<string, unknown> }>;
    };
    return body.items.filter((item) => item.brand === brand && item.flavor === flavor);
  }, { brand: BRAND, flavor: FLAVOR });
  expect(profileAfterRoundTripPreview).toHaveLength(1);
  expect(profileAfterRoundTripPreview[0]?.values.sauceOzPerPizza).toBe(1.25);

  const historyPanel = page.getByTestId("import-history-panel");
  await expect(historyPanel).toBeVisible();
  const historyEntry = historyPanel
    .locator('[data-testid^="import-history-"]:not([data-testid="import-history-panel"])')
    .filter({ hasText: FILE });
  await expect(historyEntry).toHaveCount(1);
  await historyEntry.getByRole("button").first().click();
  const undoCountBeforeCancel = applyRequests.filter((path) => /\/undo$/.test(path)).length;
  let undoCancelMessage = "";
  page.once("dialog", async (dialog) => {
    undoCancelMessage = dialog.message();
    await dialog.dismiss();
  });
  await historyEntry.getByRole("button", { name: "Undo guarded import", exact: true }).click();
  expect(undoCancelMessage).toBe("Undo this import only if no later manager edits depend on it?");
  expect(applyRequests.filter((path) => /\/undo$/.test(path))).toHaveLength(undoCountBeforeCancel);
  const reopen = historyEntry.getByRole("button", {
    name: "Reopen saved review / scoped repair",
    exact: true,
  });
  await expect(reopen).toBeVisible();
  const applyCountBeforeReopen = applyRequests.filter((path) => /\/apply$/.test(path)).length;
  await reopen.click();
  await expect(page.getByRole("dialog").filter({ hasText: "Manage Lists" })).toBeHidden();
  await expect(page.getByTestId("spec-reconcile-panel")).toBeVisible();
  await expect(page.getByTestId("spec-reconcile-result")).toBeVisible({ timeout: 20_000 });
  expect(applyRequests.filter((path) => /\/apply$/.test(path)).length)
    .toBe(applyCountBeforeReopen);

  // Use a fresh page context for the confirmed Undo so any reopened review
  // state cannot place an overlay above Import History.
  const browser = page.context().browser();
  if (!browser) throw new Error("The browser instance is unavailable for the clean history session.");
  const cleanContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await cleanContext.addCookies(await page.context().cookies());
    const undoPage = await cleanContext.newPage();
    undoPage.on("pageerror", (error) => errors.push(error.message));
    undoPage.on("response", (response) => {
      if (response.status() >= 500) {
        errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    const appOrigin = new URL(page.url()).origin;
    await undoPage.goto(appOrigin, { waitUntil: "domcontentloaded" });
    await undoPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const profileBeforeUndo = await undoPage.evaluate(async ({ brand, flavor }) => {
      const response = await fetch("/api/brand-profiles", { cache: "no-store" });
      const body = await response.json() as { items: Array<{ brand: string; flavor: string }> };
      return response.status === 200 && body.items.some((item) => item.brand === brand && item.flavor === flavor);
    }, { brand: BRAND, flavor: FLAVOR });
    expect(profileBeforeUndo).toBe(true);

    await openImportSection(undoPage);
    const cleanHistory = undoPage.getByTestId("import-history-panel");
    const cleanHistoryEntry = cleanHistory
      .locator('[data-testid^="import-history-"]:not([data-testid="import-history-panel"])')
      .filter({ hasText: FILE });
    await expect(cleanHistoryEntry).toHaveCount(1);
    await cleanHistoryEntry.getByRole("button").first().click();
    const undoButton = cleanHistoryEntry.getByRole("button", {
      name: "Undo guarded import",
      exact: true,
    });
    await expect(undoButton).toBeVisible();

    const undoResponse = undoPage.waitForResponse((response) =>
      new URL(response.url()).pathname.match(/\/api\/import-operations\/[^/]+\/undo$/) !== null &&
      response.request().method() === "POST",
    );
    let undoConfirmMessage = "";
    undoPage.once("dialog", async (dialog) => {
      undoConfirmMessage = dialog.message();
      await dialog.accept();
    });
    await undoButton.click();
    expect(undoConfirmMessage).toBe("Undo this import only if no later manager edits depend on it?");
    const undoResult = await undoResponse;
    expect(undoResult.status()).toBe(200);

    const profileAfterUndo = await undoPage.evaluate(async ({ brand, flavor }) => {
      const response = await fetch("/api/brand-profiles", { cache: "no-store" });
      const body = await response.json() as { items: Array<{ brand: string; flavor: string }> };
      return response.status === 200 && body.items.some((item) => item.brand === brand && item.flavor === flavor);
    }, { brand: BRAND, flavor: FLAVOR });
    expect(profileAfterUndo).toBe(false);

    await undoPage.reload({ waitUntil: "domcontentloaded" });
    await undoPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    const profileAfterReload = await undoPage.evaluate(async ({ brand, flavor }) => {
      const response = await fetch("/api/brand-profiles", { cache: "no-store" });
      const body = await response.json() as { items: Array<{ brand: string; flavor: string }> };
      return response.status === 200 && body.items.some((item) => item.brand === brand && item.flavor === flavor);
    }, { brand: BRAND, flavor: FLAVOR });
    expect(profileAfterReload).toBe(false);
  } finally {
    await cleanContext.close();
  }

  // Apply the exported workbook only after testing Undo of the original import;
  // otherwise the later import would correctly fence that older Undo.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const profileBeforeExportApply = await page.evaluate(async ({ brand, flavor }) => {
    const body = await (await fetch("/api/brand-profiles", { cache: "no-store" })).json() as {
      items: Array<{ brand: string; flavor: string }>;
    };
    return body.items.some((item) => item.brand === brand && item.flavor === flavor);
  }, { brand: BRAND, flavor: FLAVOR });
  expect(profileBeforeExportApply).toBe(false);
  await openImportSection(page);
  const applyExportChooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog").filter({ hasText: "Manage Lists" })
    .getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
  await (await applyExportChooser).setFiles({
    name: exportedFilename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: exportedWorkbook,
  });
  await expect(roundTripReview).toContainText("Step 1 of 2 — products", { timeout: 30_000 });
  await roundTripReview.getByRole("button", { name: "Next", exact: true }).click();
  await expect(roundTripReview).toContainText(BRAND);
  await expect(roundTripReview).toContainText(FLAVOR);
  await expect(roundTripReview).toContainText("1.25");
  const roundTripApply = roundTripReview.getByRole("button", { name: /^Apply \d+ items?$/ });
  await expect(roundTripApply).toBeEnabled();
  const roundTripPreviewWait = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/import-operations/preview",
  );
  await roundTripApply.click();
  expect((await roundTripPreviewWait).status()).toBe(200);
  const roundTripSafety = page.getByTestId("dialog-import-safety-review");
  await expect(roundTripSafety).toBeVisible();
  const roundTripApplyWait = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /^\/api\/import-operations\/[^/]+\/apply$/.test(new URL(response.url()).pathname),
  );
  await roundTripSafety.getByTestId("button-import-safety-confirm").click();
  expect((await roundTripApplyWait).status()).toBe(200);
  await expect(roundTripSafety).toBeHidden();
  await expect(roundTripReview).toBeHidden();
  expect(applyRequests.filter((path) => /\/apply$/.test(path))).toHaveLength(applyCountBeforeRoundTrip + 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  const profileAfterExportApply = await page.evaluate(async ({ brand, flavor }) => {
    const response = await fetch("/api/brand-profiles", { cache: "no-store" });
    const body = await response.json() as {
      items: Array<{ brand: string; flavor: string; values: Record<string, unknown> }>;
    };
    return body.items.filter((item) => item.brand === brand && item.flavor === flavor);
  }, { brand: BRAND, flavor: FLAVOR });
  expect(profileAfterExportApply).toHaveLength(1);
  expect(profileAfterExportApply[0]?.values.sauceOzPerPizza).toBe(1.25);

  const performanceSamples = await page.evaluate(() =>
    (window as Window & {
      __task3722PerformanceSamples?: Array<{ name: string; durationMs: number; kind: string }>;
    }).__task3722PerformanceSamples ?? [],
  );
  console.info("[audited-import-browser-diagnostics]", JSON.stringify({
    inventoryStartResponses,
    inventoryForbiddenResponses,
    performanceSamples,
    performanceWarnings,
  }));
  expect(
    inventoryStartResponses.filter((entry) => entry.phase === "staff-onboarding"),
    "a signed-in staff session must not issue the manager-only day-start inventory request",
  ).toEqual([]);
  expect(
    inventoryStartResponses.some((entry) => entry.phase === "manager-session" && entry.status === 200),
    "the manager session should still run the day-start inventory pass",
  ).toBe(true);
  expect(inventoryForbiddenResponses).toEqual([]);
  expect(errors).toEqual([]);
});

test("shared safety dialog interaction matrix: seven import labels, four responsive viewports", async ({ page }, info) => {
  const labels = ["spec", "premix", "cheese", "shipping", "sauce", "dough", "schedule"];
  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1024, height: 768 }];
  const username = uniqueTestId("manager_task3494_matrix");
  usernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: process.env.STAFF_SIGNUP_CODE ?? "",
    waitForApp: (p) => p.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 }),
    onboarding: { visibilityTimeout: 5_000 },
  });
  await setManager(username);
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 60_000 });
  // This harness invokes the shared host's exported review request with clearly synthetic
  // payloads; it is component/matrix evidence, not seven complete parser-import journeys.
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const label of labels) {
      const requestReview = (suffix: string) => page.evaluate(async ({ title, entity, suffix }) => {
        const api = await import("/src/importSafetyReview.ts");
        return api.requestImportSafetyReview({
          title: `Review ${title} ${suffix}`,
          recovery: "Synthetic matrix fixture; no data is applied.",
          changes: [
            { action: "change", entity, key: `${entity}-synthetic`, label: `${entity} fixture`, fields: [
              { field: "amount", before: 1, after: 2, unit: entity === "schedule" ? "cases" : "lb/batch" },
              { field: "portion", before: null, after: 0.75, unit: "oz/pizza" },
            ] },
            ...Array.from({ length: 24 }, (_, i) => ({
              action: i % 2 ? "create" : "link", entity, key: `${entity}-row-${i}`,
              label: `${entity} searchable fixture ${i}`, fields: [{ field: "notes", before: null, after: `Synthetic ${i}` }],
            })),
          ],
          baseline: { status: "unavailable", label: "Prior-source evidence unavailable; not a defect.", changes: [] },
        });
      }, { title: label, entity: label, suffix });
      const result = requestReview("changes");
      const dialog = page.getByTestId("dialog-import-safety-review");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Source version differences");
      await expect(dialog).toContainText("Unknown / not supplied");
      await expect(dialog.getByTestId("button-import-safety-cancel")).toBeInViewport();
      await expect(dialog.getByTestId("button-import-safety-confirm")).toBeInViewport();
      const bounds = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      const search = dialog.getByPlaceholder("Search recipe, profile, field, value…").first();
      await search.fill(`${label} searchable fixture 23`);
      await expect(dialog).toContainText("Showing 1 of 25");
      await search.fill("");
      await dialog.getByRole("button", { name: "Created 12", exact: true }).click();
      await expect(dialog).toContainText("Showing 12 of 25");
      await dialog.getByRole("button", { name: /All 25/ }).click();
      if (info.project.name === "chromium" && label === "spec") {
        await attachVisualEvidence(
          page,
          info,
          `task3722-import-safety-${viewport.width}x${viewport.height}`,
        );
      }
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await dialog.getByTestId("button-import-safety-cancel").click();
      await expect(dialog).toBeHidden();
      expect(await result).toBe(false);
      const resumed = requestReview("resumed review");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("button-import-safety-confirm").click();
      await expect(dialog).toBeHidden();
      expect(await resumed).toBe(true);
    }
  }
});
