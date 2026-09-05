/**
 * Manager browser regression: optional AI enrichment can be unavailable without
 * hiding deterministic production data.
 *
 * The test deliberately returns successful JSON with aiStatus=unavailable from
 * the optional endpoints. It then uses the real manager UI to verify:
 *   - Excel import mappings remain reviewable;
 *   - spec and premix reconciliation discrepancies remain visible;
 *   - recap stats remain visible;
 *   - schedule order and its apply control remain visible;
 *   - forecast data remains visible; and
 *   - optimization recommendations remain visible.
 *
 * The fixture APIs are read-only browser responses. The only database mutation
 * is creation/removal of the isolated authenticated test user.
 */

import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "AiOutageReview123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

const FIXTURE = uniqueTestId("ai_outage");
const BRAND = "Aldo's";
const EXISTING_FLAVOR = "Classic";
const IMPORTED_FLAVOR = `Imported Flavor ${FIXTURE}`;
const SPEC_RECIPE = `Outage Dough ${FIXTURE}`;
const PREMIX_LABEL = `Outage premix ${FIXTURE}`;
const SPEC_LABEL = `Outage spec ${FIXTURE}`;

const SPEC_SHEET_ID = 910_001;
const PREMIX_SHEET_ID = 910_002;
const MIX_ID = `outage-mix-${FIXTURE}`;

const MIX = {
  id: MIX_ID,
  name: `Outage mix ${FIXTURE}`,
  brand: BRAND,
  flavor: EXISTING_FLAVOR,
  batchSize: 10,
  daysEarly: 0,
  amountAlreadyMade: 0,
  components: [{ ingredient: "Mozzarella", perPizza: 0.5 }],
  enabled: true,
};

const SPEC_SHEET = {
  id: SPEC_SHEET_ID,
  label: SPEC_LABEL,
  sourceKey: `outage-${FIXTURE}`,
  createdAt: Date.now(),
  data: {
    recipes: [{ kind: "dough", name: SPEC_RECIPE, rows: [] }],
    profiles: [],
  },
};

const PREMIX_SHEET = {
  id: PREMIX_SHEET_ID,
  label: PREMIX_LABEL,
  sourceKey: `outage-premix-${FIXTURE}`,
  createdAt: Date.now(),
  data: [
    {
      ...MIX,
      components: [{ ingredient: "Mozzarella", perPizza: 0.75 }],
    },
  ],
};

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows[0]?.id, "sign-up did not create a database user").toBeTruthy();
    await db.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0]!.id],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

function workbookFixture(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    [BRAND, IMPORTED_FLAVOR, 12, "review mapping"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Production Runs");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

async function installFixtureRoutes(page: Page): Promise<void> {
  await page.route("**/api/import-aliases", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { aliases: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.route("**/api/spec-sheets", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { specSheets: [SPEC_SHEET] } });
      return;
    }
    await route.fulfill({ json: { specSheets: [SPEC_SHEET] } });
  });

  await page.route("**/api/premix-sheets", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { premixSheets: [PREMIX_SHEET] } });
      return;
    }
    await route.fulfill({ json: { premixSheets: [PREMIX_SHEET] } });
  });

  await page.route("**/api/mixes", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [MIX] } });
      return;
    }
    await route.fulfill({ json: { items: [MIX] } });
  });

  await page.route("**/api/ai/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const base = { generatedAt: Date.now(), aiStatus: "unavailable" as const };

    if (path.endsWith("/match-import")) {
      await route.fulfill({
        json: { ...base, brandMatches: [], flavorMatches: [] },
      });
      return;
    }
    if (path.endsWith("/spec-reconcile")) {
      await route.fulfill({
        json: {
          ...base,
          specSheetId: SPEC_SHEET_ID,
          discrepancies: [
            {
              kind: "dough",
              recipeName: SPEC_RECIPE,
              type: "ingredient-mismatch",
              message: "Dough hydration differs from the saved spec.",
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/mix-reconcile")) {
      await route.fulfill({ json: { ...base, summary: "" } });
      return;
    }
    if (path.endsWith("/forecast")) {
      await route.fulfill({
        json: {
          ...base,
          forecast: {
            targetDate: "2099-01-02",
            confidence: "medium",
            summary: "Run the Classic line first.",
            runs: [
              {
                brand: BRAND,
                flavor: EXISTING_FLAVOR,
                dieType: "",
                casesNeeded: 24,
                rationale: "Recent demand supports the planned quantity.",
              },
            ],
          },
        },
      });
      return;
    }
    if (path.endsWith("/summary")) {
      await route.fulfill({
        json: {
          ...base,
          summary: "24 cases made against 30 planned; the shift stayed on track.",
          stats: {
            scope: "day",
            date: "2099-01-01",
            runsPlanned: 2,
            runsFinished: 1,
            casesPlanned: 30,
            casesProduced: 24,
            attainmentPct: 80,
            totalDowntimeMinutes: 12,
            totalStoppages: 2,
            topDowntime: { label: "Classic", minutes: 12 },
            unfinishedRuns: ["Aldo's — Imported Flavor"],
            incidentCount: 1,
            wasteFlaggedCount: 0,
            hasData: true,
          },
          aiGenerated: false,
        },
      });
      return;
    }
    if (path.endsWith("/schedule-optimize")) {
      await route.fulfill({
        json: {
          ...base,
          order: ["schedule-run-2", "schedule-run-1"],
          changed: true,
          improved: true,
          before: { allergenViolations: 1, ruleViolations: 1, changeovers: 3 },
          after: { allergenViolations: 0, ruleViolations: 0, changeovers: 1 },
          summary: "",
          aiGenerated: false,
        },
      });
      return;
    }
    if (path.endsWith("/optimize")) {
      await route.fulfill({
        json: {
          ...base,
          recommendations: [
            {
              category: "run",
              title: "Prioritize the Classic line",
              detail: "Start the Classic line before the next changeover.",
              impact: "medium",
              action: { kind: "set_target_time", time: "08:00" },
            },
          ],
        },
      });
      return;
    }

    // Keep unrelated optional enrichment calls fail-safe during this outage
    // scenario without allowing them to make real provider requests.
    await route.fulfill({ json: base });
  });
}

async function openMoreMenu(page: Page): Promise<void> {
  await page.locator('button[title="More"]').click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await openMoreMenu(page);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manage Lists & Settings" }),
  ).toBeVisible();
}

async function hideDevelopmentBanner(page: Page): Promise<void> {
  // The injected Replit banner can cover fixed mobile controls. It is not
  // product UI and must not turn a phone reviewability check into a hit-target
  // failure.
  await page.addStyleTag({
    content: "#replit-dev-banner { display: none !important; }",
  });
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("AI outage reviewability browser check");
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("keeps manager production data reviewable when optional AI is unavailable", async ({ page }) => {
  await installFixtureRoutes(page);

  const username = uniqueTestId("ai_outage_manager");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
  await promoteToManager(username);

  // Give the import review one deterministic existing brand/flavor to map
  // against. The imported flavor intentionally remains unmatched so the
  // successful unavailable response is observable in the real dialog.
  await page.evaluate(
    ({ brand, flavor }) => {
      localStorage.setItem("run-calc-brands", JSON.stringify([brand]));
      localStorage.setItem(
        "run-calc-brand-flavors",
        JSON.stringify({ [brand]: [flavor] }),
      );
    },
    { brand: BRAND, flavor: EXISTING_FLAVOR },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await hideDevelopmentBanner(page);

  // ExcelImportDialog: deterministic row/mapping controls survive the
  // unavailable match-import enrichment.
  await openSettings(page);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.locator('input[type="file"][accept=".xlsx,.xls"]').first().setInputFiles({
    name: `outage-${FIXTURE}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbookFixture(),
  });

  const importDialog = page.getByRole("dialog", { name: "Import Excel" });
  await expect(importDialog).toBeVisible();
  await expect(importDialog.getByText("Map Flavors", { exact: true })).toBeVisible();
  await expect(importDialog.getByText(new RegExp(`${BRAND}.*${IMPORTED_FLAVOR}`))).toBeVisible();
  await expect(importDialog.getByText(IMPORTED_FLAVOR).first()).toBeVisible();
  await expect(importDialog.getByTestId("ai-status-unavailable")).toContainText(
    "AI matching unavailable. Deterministic results are still available.",
  );
  await importDialog.getByRole("button", { name: "Close import review" }).click();

  // SpecReconcilePanel: the deterministic discrepancy returned alongside the
  // unavailable advisory remains visible after entering the AI Assistant tab.
  await page.getByRole("button", { name: "Close settings" }).click();
  await openMoreMenu(page);
  await page.getByRole("menuitem", { name: "AI Assistant", exact: true }).click();
  const specPanel = page.getByTestId("spec-reconcile-panel");
  await expect(specPanel).toBeVisible();
  await specPanel.getByTestId(`button-check-spec-${SPEC_SHEET_ID}`).click();
  await expect(specPanel.getByTestId("spec-reconcile-result")).toContainText(SPEC_RECIPE);
  await expect(specPanel.getByTestId("spec-reconcile-result")).toContainText(
    "Dough hydration differs from the saved spec.",
  );
  await expect(specPanel.getByTestId("ai-status-unavailable")).toContainText(
    "AI reconciliation unavailable. Deterministic results are still available.",
  );

  // MixReconcilePanel: the client-side discrepancy calculation remains visible
  // alongside the unavailable narration endpoint.
  await page.getByTestId("tab-run").click();
  await openSettings(page);
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("button", { name: "Mix Recipes", exact: true }).click();
  const mixPanel = page.getByTestId("mix-reconcile-panel");
  await expect(mixPanel).toBeVisible();
  await mixPanel.getByTestId(`button-check-premix-${PREMIX_SHEET_ID}`).click();
  await expect(mixPanel.getByTestId("mix-reconcile-result")).toContainText(PREMIX_LABEL);
  await expect(mixPanel.getByTestId(`mix-reconcile-item-${MIX_ID}`)).toBeVisible();
  await expect(mixPanel.getByTestId("ai-status-unavailable")).toContainText(
    "AI reconciliation unavailable. Deterministic results are still available.",
  );

  // AssistantTab: recap, schedule, forecast, and optimization results all
  // render from successful unavailable responses.
  await page.getByRole("button", { name: "Close settings" }).click();
  await openMoreMenu(page);
  await page.getByRole("menuitem", { name: "AI Assistant", exact: true }).click();

  await page.getByTestId("button-summary-day").click();
  const summaryResult = page.getByTestId("summary-result");
  await expect(summaryResult).toContainText("24 cases made against 30 planned");
  await expect(summaryResult.getByText("1/2", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("80%", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("24", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("12m", { exact: true })).toBeVisible();
  await expect(
    summaryResult.getByText(
      "AI recap unavailable. Deterministic results are still available.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByTestId("button-schedule-optimize").click();
  const scheduleResult = page.getByTestId("schedule-result");
  await expect(scheduleResult.getByTestId("schedule-order-0")).toContainText("schedule-run-2");
  await expect(scheduleResult.getByTestId("schedule-order-1")).toContainText("schedule-run-1");
  await expect(scheduleResult.getByTestId("button-schedule-apply")).toBeVisible();
  await expect(
    scheduleResult.getByText(
      "AI schedule narration unavailable. Deterministic results are still available.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByTestId("button-forecast").click();
  await expect(page.getByText("Run the Classic line first.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("forecast-confidence")).toHaveText("medium confidence");
  await expect(page.getByText("AI forecast unavailable. Deterministic results are still available.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Analyze shift", exact: true }).click();
  await expect(page.getByText("Prioritize the Classic line", { exact: true })).toBeVisible();
  await expect(page.getByText("AI optimization unavailable. Deterministic results are still available.", { exact: true })).toBeVisible();
});