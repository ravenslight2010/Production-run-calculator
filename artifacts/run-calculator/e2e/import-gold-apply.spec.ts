import { expect, test, type Page } from "@playwright/test";
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
type ListedCase = { id: number; importType: ImportKind; sourceLabel: string };

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
      [recipeName],
      ["", "LBS"],
      ["Mozzarella", "10"],
      ["Total", "10"],
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
