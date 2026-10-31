import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { requireIsolatedTestDatabase } from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const suffix = Math.random().toString(36).slice(2, 10);
const username = `visual_${suffix}`;
const phoneUsername = `visual_phone_${suffix}`;
const tabletUsername = `visual_tablet_${suffix}`;
const password = "VisualRegression123!";
let cleanupDb: Client | undefined;

const visualMixFixture = {
  id: `visual_mix_${suffix}`,
  name: "Visual Fixture Mix",
  brand: "Visual Regression Bakery",
  flavor: "Screenshot Fixture",
  batchSize: 40,
  daysEarly: 0,
  notes: "Deterministic visual fixture",
  amountAlreadyMade: 0,
  // Keep the fixture master row deliberately unrelated to the seeded default
  // run. The visual state asserts the empty Mix Plan before import review.
  components: [{ ingredient: `Visual Fixture Ingredient ${suffix}`, perPizza: 1.5 }],
  isPrep: false,
  enabled: true,
};

async function signUp(page: Page, account = username): Promise<void> {
  // The facility-wide badge depends on unrelated import reviews left by
  // earlier serial browser cases. Fix its display state for these screenshots;
  // live badge/API behavior is covered by the QC review browser cases.
  await page.route("**/api/qc/import-review-badges", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pending: 1, rejected: 1 }),
    });
  });
  // Keep the existing-brand mapping branch deterministic across serial runs.
  // The factory directory contract requires a timestamped entry; preserve the
  // real response envelope and modify only this in-memory read response.
  await page.route("**/api/factory-data**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.json() as {
      data?: Record<string, { value?: unknown; updatedAt?: string }>;
      [key: string]: unknown;
    };
    const data = body.data ?? {};
    data["run-calc-brands"] = {
      ...(data["run-calc-brands"] ?? {}),
      value: ["Visual Regression Existing Brand"],
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    await route.fulfill({
      response,
      body: JSON.stringify({ ...body, data }),
    });
  });
  await signUpAndHandleOnboarding(page, account, password, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      dialog: (currentPage) => currentPage.getByRole("dialog"),
      visibilityTimeout: 10_000,
      button: (dialog) => dialog.getByRole("button").last(),
      clickOptions: { force: true },
      actionLabel: "final onboarding action",
      afterComplete: async (currentPage) => {
        // Radix keeps the closing overlay mounted during its exit animation.
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 15_000 })
          .catch(() => {});
        await currentPage.waitForTimeout(500);
      },
    },
    afterSignUp: async (currentPage) => {
      // Some dev builds retain the aria-hidden Radix overlay in the portal
      // after the exit animation. Remove only aria-hidden overlays in this
      // isolated fixture; this cannot affect a visible production dialog.
      await currentPage.evaluate(() => {
        document
          .querySelectorAll('[data-state="open"][aria-hidden="true"]')
          .forEach((element) => element.remove());
      });
      if (cleanupDb) {
        await cleanupDb.query(
          "UPDATE users SET onboarding_seen = true WHERE username = $1",
          [account],
        );
        await currentPage.reload({ waitUntil: "domcontentloaded" });
        await currentPage.locator('[data-testid="tab-run"]').waitFor({
          state: "attached",
          timeout: 25_000,
        });
      }
    },
  });
}

async function goToMixPlan(page: Page): Promise<void> {
  await page.locator('button[title="More"]').click();
  await page.getByRole("menuitem", { name: /^(mixes|mix plan)$/i }).click();
  await page.locator('[data-testid="mix-make-day"]').waitFor({
    state: "visible",
    timeout: 10_000,
  });
  // Master-data bootstrap is intentionally jittered to avoid a startup
  // thundering herd. Wait for the fixture-backed plan state, not the
  // transient "no recipes" state that renders before bootstrap completes.
  // Accepting both states lets the assertion race the real master-data load.
  await expect
    .poll(
      async () =>
        await page
          .getByText("No mixes to make for this day. Pick a make-day with scheduled runs whose product matches a mix (within its days-early window).", {
            exact: true,
          })
          .isVisible()
          .catch(() => false),
      { timeout: 15_000 },
    )
    .toBe(true);
}

function importWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Brand", "Flavor", "Cases Planned", "Notes"],
    ["Visual Bakery", "Classic", 48, "Review fixture"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Production Runs");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

async function waitForSavedFlashToSettle(page: Page): Promise<void> {
  const savedFlash = page.getByText("Saved", { exact: true });
  await expect(savedFlash).toHaveCSS("opacity", "0");
  // Start/resize writes can trigger a later flash; allow its 1.8s hold and
  // 0.5s fade to finish before capturing a baseline.
  await page.waitForTimeout(2_500);
  await expect(savedFlash).toHaveCSS("opacity", "0");
}

function dynamicMask(page: Page) {
  return [
    // The Replit preview banner is injected by the local preview host, not
    // rendered by the product. Keep it out of product screenshots while
    // retaining the page-level visual assertion.
    page.locator("#replit-dev-banner"),
    page.locator("time"),
    page.locator('[data-testid*="timer"]'),
    page.locator('[data-testid*="clock"]'),
    page.locator('[data-testid*="timestamp"]'),
    page.locator('[data-testid="elapsed-card-value"]'),
    page.getByTestId("operational-state-badge"),
    // Review counts are facility-wide and can change as preceding serial
    // browser cases create or resolve unrelated import reviews. Keep the badge
    // and its layout visible, but mask only the changing count text.
    page.getByTestId("text-qc-import-badge-pending"),
    page.getByTestId("text-qc-import-badge-rejected"),
    page.locator('input[type="date"]'),
  ];
}

test.describe("intentional visual regression baselines", () => {
  test.describe.configure({ mode: "serial" });
  // The checked-in desktop/tablet baselines are intentionally 1280×900.
  // Desktop Chrome's device preset defaults to 1280×720, which would make
  // the baseline contract fail before comparing the rendered application.
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    requireIsolatedTestDatabase("visual regression beforeAll");
    cleanupDb = new Client({ connectionString: process.env.DATABASE_URL });
    await cleanupDb.connect();
    await cleanupDb.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toLocaleDateString("en-CA"),
    ]);
    for (const scope of ["live", "sandbox"]) {
      await cleanupDb.query(
        `INSERT INTO mixes
           (id, scope, name, brand, flavor, batch_size, days_early, notes,
            amount_already_made, components, is_prep, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, true, NOW(), NOW())
         ON CONFLICT (id, scope) DO UPDATE SET
           name = EXCLUDED.name,
           brand = EXCLUDED.brand,
           flavor = EXCLUDED.flavor,
           batch_size = EXCLUDED.batch_size,
           days_early = EXCLUDED.days_early,
           notes = EXCLUDED.notes,
           amount_already_made = EXCLUDED.amount_already_made,
           components = EXCLUDED.components,
           is_prep = EXCLUDED.is_prep,
           enabled = true,
           updated_at = NOW()`,
        [
          visualMixFixture.id,
          scope,
          visualMixFixture.name,
          visualMixFixture.brand,
          visualMixFixture.flavor,
          visualMixFixture.batchSize,
          visualMixFixture.daysEarly,
          visualMixFixture.notes,
          visualMixFixture.amountAlreadyMade,
          JSON.stringify(visualMixFixture.components),
          visualMixFixture.isPrep,
        ],
      );
    }
  });

  test.beforeEach(async () => {
    requireIsolatedTestDatabase("visual regression beforeEach");
    await cleanupDb?.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toLocaleDateString("en-CA"),
    ]);
  });

  test.afterAll(async () => {
    if (!cleanupDb) return;
    try {
      await cleanupDb.query("DELETE FROM mixes WHERE id = $1 AND scope IN ('live', 'sandbox')", [
        visualMixFixture.id,
      ]);
      await cleanupDb.query("DELETE FROM users WHERE username = ANY($1::text[])", [
        [username, phoneUsername, tabletUsername],
      ]);
    } finally {
      await cleanupDb.end().catch(() => {});
      cleanupDb = undefined;
    }
  });

  test("desktop production states: live run, Mix Plan, import review, and alert dialog", async ({
    page,
  }) => {
    await signUp(page, phoneUsername);
    const startRun = page.getByRole("button", { name: /start run/i });
    if (await startRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await startRun.click();
    }
    await page.getByRole("button", { name: /pause run/i }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await expect(page.getByTestId("operational-state-badge")).toHaveText(
      "Confirmed server baseline",
    );
    // Foreground reconciliation can display an outcome notice after Start.
    // Dismiss that transient state rather than recording it in the baseline.
    const syncOutcome = page.getByTestId("foreground-recovery-status");
    if (await syncOutcome.isVisible().catch(() => false)) {
      await expect(syncOutcome).toHaveAttribute("data-foreground-recovery-state", "outcome");
      const message = await syncOutcome.locator("span").first().innerText();
      expect([
        "Production state synchronized.",
        "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.",
      ]).toContain(message);
      await syncOutcome.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(syncOutcome).toBeHidden();
    }
    await expect(page.getByTestId("badge-qc-import-review")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("text-qc-import-badge-pending")).toBeVisible();
    await expect(page.getByTestId("text-qc-import-badge-rejected")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await waitForSavedFlashToSettle(page);

    await expect(page).toHaveScreenshot("live-run-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });

    await goToMixPlan(page);
    // Opening the header menu can leave its trigger focused in some Chromium
    // runs. Clear that transient focus ring so the Mix Plan baseline captures
    // the page, not the menu interaction that navigated to it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.getByText(
      "No mixes to make for this day. Pick a make-day with scheduled runs whose product matches a mix (within its days-early window).",
      { exact: true },
    )).toBeVisible();
    await expect(page).toHaveScreenshot("mix-plan-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });

    // Feed a deterministic workbook directly to the same hidden input used by
    // the Import Excel button. This exercises the real parse and review UI
    // without depending on a filesystem fixture or shared master-data counts.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "visual-review.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: importWorkbook(),
    });
    await page.getByText("Import Excel", { exact: true }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await expect(page.locator(
      'select option[value="Visual Regression Existing Brand"]',
    )).toHaveCount(1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page).toHaveScreenshot("import-review-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
    // The review dialog's close control is icon-only; scope the click to the
    // modal so unrelated page buttons cannot be selected.
    await page.locator(".responsive-dialog-overlay").filter({ hasText: "Import Excel" })
      .locator("button").first().click();

    await page.locator('[data-testid="tab-run"]').click();
    await expect(page).toHaveScreenshot("compact-run-tablet.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
  });

  test("phone compact presentation and stop dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page);
    await page.locator('[data-testid="tab-run"]').click();
    const startRun = page.getByRole("button", { name: /start run/i });
    if (await startRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await startRun.click();
    }
    await page.getByRole("button", { name: /pause run/i }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await expect(page.getByTestId("operational-state-badge")).toHaveText(
      "Confirmed server baseline",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("operational-state-badge")).toBeVisible();
    // Running controls can render before the canonical run's start timestamp
    // reaches the compact timer. Wait for the complete running state so this
    // screenshot does not capture a transient half-started layout.
    await expect(page.getByTestId("elapsed-card-value")).toBeVisible({
      timeout: 10_000,
    });
    // Match the desktop/tablet capture boundary: the foreground sync outcome
    // is transient and shifts the whole phone layout while it is displayed.
    const syncOutcome = page.getByTestId("foreground-recovery-status");
    if (await syncOutcome.isVisible().catch(() => false)) {
      await expect(syncOutcome).toHaveAttribute("data-foreground-recovery-state", "outcome");
      const message = await syncOutcome.locator("span").first().innerText();
      expect([
        "Production state synchronized.",
        "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.",
      ]).toContain(message);
      await syncOutcome.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(syncOutcome).toBeHidden();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page).toHaveScreenshot("run-overview-phone.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
  });

  test("tablet portrait and landscape compact presentation", async ({ page }) => {
    await signUp(page, tabletUsername);
    await page.locator('[data-testid="tab-run"]').click();
    const startRun = page.getByRole("button", { name: /start run/i });
    if (await startRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await startRun.click();
    }
    await page.getByRole("button", { name: /pause run/i }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await expect(page.getByTestId("operational-state-badge")).toHaveText(
      "Confirmed server baseline",
      { timeout: 15_000 },
    );
    await expect(page.locator('button[title="Sync connected"]')).toHaveText(
      "Synchronized",
      { timeout: 15_000 },
    );
    // Foreground reconciliation can display an outcome notice after Start.
    // Dismiss that transient state rather than recording it in the baseline.
    const syncOutcome = page.getByTestId("foreground-recovery-status");
    if (await syncOutcome.isVisible().catch(() => false)) {
      await expect(syncOutcome).toHaveAttribute("data-foreground-recovery-state", "outcome");
      const message = await syncOutcome.locator("span").first().innerText();
      expect([
        "Production state synchronized.",
        "Latest production snapshot received. Unsaved edits are not confirmed by this refresh; resolve any section warning before saving again.",
      ]).toContain(message);
      await syncOutcome.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(syncOutcome).toBeHidden();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.getByTestId("badge-qc-import-review")).toHaveCSS(
      "position",
      "static",
    );

    await page.setViewportSize({ width: 768, height: 1024 });
    await waitForSavedFlashToSettle(page);
    await expect(page).toHaveScreenshot("run-overview-tablet-portrait.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });

    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForSavedFlashToSettle(page);
    await expect(page).toHaveScreenshot("run-overview-tablet-landscape.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
  });
});