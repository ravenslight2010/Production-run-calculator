import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

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

async function settingsImport(page: Page): Promise<void> {
  await page.getByRole("button", { name: /more/i }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();
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
  await setManager(username);
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
  await info.attach("task3494-spec-final-safety-review-before-cancel", {
    body: await safety.screenshot({ type: "jpeg", quality: 75 }), contentType: "image/jpeg",
  });
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

  // Re-open the safety boundary and confirm; preview and apply remain separate requests.
  const previewWait2 = page.waitForResponse((r) =>
    r.url().endsWith("/api/import-operations/preview") && r.request().method() === "POST");
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
      if (info.project.name === "chromium" && viewport.width === 390 && label === "spec") {
        await info.attach("task3494-shared-dialog-phone-search-filter", {
          body: await dialog.screenshot({ type: "jpeg", quality: 75 }), contentType: "image/jpeg",
        });
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
