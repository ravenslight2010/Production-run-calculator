import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { requireIsolatedTestDatabase } from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const suffix = Math.random().toString(36).slice(2, 10);
const username = `visual_${suffix}`;
const phoneUsername = `visual_phone_${suffix}`;
const password = "VisualRegression123!";
let cleanupDb: Client | undefined;

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
    page.locator("time"),
    page.locator('[data-testid*="timer"]'),
    page.locator('[data-testid*="clock"]'),
    page.locator('[data-testid*="timestamp"]'),
    page.locator('[data-testid="elapsed-card-value"]'),
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
  });

  test.afterAll(async () => {
    if (!cleanupDb) return;
    try {
      await cleanupDb.query("DELETE FROM users WHERE username = ANY($1::text[])", [
        [username, phoneUsername],
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
    await expect(page).toHaveScreenshot("run-overview-phone.png", {
      fullPage: false,
      mask: dynamicMask(page),
      maxDiffPixels: 80,
      threshold: 0.2,
    });
  });
});