/**
 * Manager browser regression: optional enrichment can be unavailable without
 * hiding deterministic management workflows.
 *
 * The test deliberately returns successful JSON with aiStatus=unavailable from
 * the optional endpoints. It then uses the real manager UI to verify:
 *   - spec reconciliation discrepancies remain visible;
 *   - import reconciliation history remains reviewable;
 *   - recap and anomaly facts remain visible; and
 *   - schedule ordering remains explicitly applyable and undoable.
 *
 * The fixture APIs are read-only browser responses. The only database mutation
 * is creation/removal of the isolated authenticated test user.
 */

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "AiOutageReview123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

const FIXTURE = uniqueTestId("ai_outage");
const BRAND = "Aldo's";
const EXISTING_FLAVOR = "Classic";
const SPEC_RECIPE = `Outage Dough ${FIXTURE}`;
const SPEC_LABEL = `Outage spec ${FIXTURE}`;

const SPEC_SHEET_ID = 910_001;
const SCHEDULE_RUN_1 = "outage-schedule-run-1";
const SCHEDULE_RUN_2 = "outage-schedule-run-2";

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

async function installFixtureRoutes(page: Page): Promise<void> {
  await page.route("**/api/spec-sheets", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { specSheets: [SPEC_SHEET] } });
      return;
    }
    await route.fulfill({ json: { specSheets: [SPEC_SHEET] } });
  });

  await page.route("**/api/import-history**", async (route) => {
    await route.fulfill({
      json: {
        imports: [{
          id: 910_003,
          importType: "spec",
          sourceKey: `outage-${FIXTURE}`,
          sourceLabel: SPEC_LABEL,
          customerScope: BRAND,
          status: "partial",
          snapshotId: SPEC_SHEET_ID,
          createdAt: Date.now(),
          summary: {
            source: { recipes: 2 },
            landed: { recipes: 1 },
            mismatches: ["One recipe needs review."],
          },
        }],
      },
    });
  });

  const unavailable = { generatedAt: Date.now(), aiStatus: "unavailable" as const };
  await page.route("**/api/ai/spec-reconcile", async (route) => {
    await route.fulfill({ json: {
      ...unavailable,
      specSheetId: SPEC_SHEET_ID,
      discrepancies: [{
        kind: "dough",
        recipeName: SPEC_RECIPE,
        type: "ingredient-mismatch",
        message: "Dough hydration differs from the saved spec.",
      }],
    } });
  });
  await page.route("**/api/ai/summary", async (route) => {
    await route.fulfill({ json: {
      ...unavailable,
      summary: "24 cases made against 30 planned; the shift stayed on track.",
      stats: {
        scope: "day", date: "2099-01-01", runsPlanned: 2, runsFinished: 1,
        casesPlanned: 30, casesProduced: 24, attainmentPct: 80,
        totalDowntimeMinutes: 12, totalStoppages: 2,
        topDowntime: { label: "Classic", minutes: 12 },
        unfinishedRuns: ["Aldo's — Classic"], incidentCount: 1,
        wasteFlaggedCount: 0, hasData: true,
      },
      aiGenerated: false,
    } });
  });
  await page.route("**/api/ai/anomalies", async (route) => {
    await route.fulfill({ json: {
      ...unavailable,
      anomalies: [{
        runLabel: `${BRAND} — ${EXISTING_FLAVOR}`,
        brand: BRAND, flavor: EXISTING_FLAVOR, metric: "downtime",
        observed: 12, baseline: 2, severity: "high", baselineSamples: 4,
        description: "Downtime is above the recent baseline.",
      }],
      checkedRuns: 2, baselineRuns: 4, summary: "", aiGenerated: false,
    } });
  });
  await page.route("**/api/ai/schedule-optimize", async (route) => {
    await route.fulfill({ json: {
      ...unavailable,
      order: [SCHEDULE_RUN_2, SCHEDULE_RUN_1],
      changed: true, improved: true,
      before: { allergenViolations: 1, ruleViolations: 1, changeovers: 3 },
      after: { allergenViolations: 0, ruleViolations: 0, changeovers: 1 },
      summary: "", aiGenerated: false,
    } });
  });
}

async function openMoreMenu(page: Page): Promise<void> {
  await page.locator('button[title="More"]').click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function openManagement(page: Page): Promise<void> {
  await openMoreMenu(page);
  await page.getByRole("menuitem", { name: "Operations Insights", exact: true }).click();
  await expect(page.getByText("Production Recap", { exact: true })).toBeVisible();
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

test("keeps deterministic management workflows reviewable when enrichment is unavailable", async ({ page }) => {
  await installFixtureRoutes(page);

  const username = uniqueTestId("ai_outage_manager");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
  await promoteToManager(username);

  await page.evaluate(
    ({ brand, flavor, firstRunId, secondRunId }) => {
      localStorage.setItem("run-calc-day", JSON.stringify({
        runs: [
          { id: firstRunId, brand, flavor, seeded: false },
          { id: secondRunId, brand, flavor, seeded: false },
        ],
        currentIndex: 0,
        date: new Date().toISOString().slice(0, 10),
        resetAt: 0,
        substitutions: [],
        substitutionLog: [],
        stagedItems: {},
        prepPhase: {
          prepStartedAt: null,
          prepBatchesDough: 0,
          prepBatchesSauce: 0,
          prepCarriedOver: false,
        },
      }));
      localStorage.setItem(`run-calc-run-${firstRunId}`, JSON.stringify({}));
      localStorage.setItem(`run-calc-run-${secondRunId}`, JSON.stringify({}));
    },
    {
      brand: BRAND,
      flavor: EXISTING_FLAVOR,
      firstRunId: SCHEDULE_RUN_1,
      secondRunId: SCHEDULE_RUN_2,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  await hideDevelopmentBanner(page);

  await openManagement(page);

  // The deterministic discrepancy remains available when its optional
  // enrichment is unavailable.
  const specPanel = page.getByTestId("spec-reconcile-panel");
  await expect(specPanel).toBeVisible();
  await specPanel.getByTestId(`button-check-spec-${SPEC_SHEET_ID}`).click();
  await expect(specPanel.getByTestId("spec-reconcile-result")).toContainText(SPEC_RECIPE);
  await expect(specPanel.getByTestId("spec-reconcile-result")).toContainText(
    "Dough hydration differs from the saved spec.",
  );
  const historyPanel = page.getByTestId("import-history-panel");
  await expect(historyPanel).toBeVisible();
  await historyPanel.getByText(SPEC_LABEL, { exact: true }).click();
  await expect(historyPanel.getByText("Source → landed reconciliation", { exact: true })).toBeVisible();
  await expect(historyPanel.getByText("One recipe needs review.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Today", exact: true }).click();
  const summaryResult = page.getByTestId("summary-result");
  await expect(summaryResult).toContainText("24 cases made against 30 planned");
  await expect(summaryResult.getByText("1/2", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("80%", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("24", { exact: true })).toBeVisible();
  await expect(summaryResult.getByText("12m", { exact: true })).toBeVisible();
  await page.getByTestId("button-anomaly-check").click();
  await expect(page.getByTestId("anomaly-item-0")).toContainText(
    "Downtime is above the recent baseline.",
  );

  await page.getByTestId("button-schedule-optimize").click();
  await expect(page.getByTestId("schedule-order-0")).toContainText(SCHEDULE_RUN_2);
  await expect(page.getByTestId("schedule-order-1")).toContainText(SCHEDULE_RUN_1);
  await page.getByTestId("button-schedule-apply").click();
  await expect(page.getByText("Run order updated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Order restored", { exact: true })).toBeVisible();
});