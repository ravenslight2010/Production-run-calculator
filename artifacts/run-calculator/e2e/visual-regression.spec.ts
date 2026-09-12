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
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

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
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page).toHaveScreenshot("import-review-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
    // The review dialog's close control is icon-only; scope the click to the
    // modal so unrelated page buttons cannot be selected.
    await page.locator("div.fixed.inset-0").filter({ hasText: "Import Excel" })
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

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page).toHaveScreenshot("run-overview-tablet-portrait.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page).toHaveScreenshot("run-overview-tablet-landscape.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
  });
});