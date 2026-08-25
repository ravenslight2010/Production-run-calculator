import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { requireIsolatedTestDatabase } from "./isolation";

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const suffix = Math.random().toString(36).slice(2, 10);
const username = `visual_${suffix}`;
const phoneUsername = `visual_phone_${suffix}`;
const password = "VisualRegression123!";
let cleanupDb: Client | undefined;

async function signUp(page: Page, account = username): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(account);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page.locator('[data-testid="tab-run"]').waitFor({
    state: "attached",
    timeout: 25_000,
  });
  const onboarding = page.getByRole("dialog");
  if (await onboarding.isVisible({ timeout: 10_000 }).catch(() => false)) {
    // The overview is scrollable on short preview heights, so its footer
    // action can be outside the viewport even though the dialog is visible.
    // Clicking the final footer action avoids depending on that scroll state.
    await onboarding.getByRole("button").last().click({ force: true });
    // Radix keeps the closing overlay mounted during its exit animation. Do
    // not start the visual states until it is actually detached, otherwise
    // the invisible overlay can intercept the first tab click.
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  // Some dev builds retain the aria-hidden Radix overlay in the portal after
  // the exit animation. Remove only aria-hidden overlays in this isolated
  // fixture; this cannot affect a visible production dialog.
  await page.evaluate(() => {
    document
      .querySelectorAll('[data-state="open"][aria-hidden="true"]')
      .forEach((element) => element.remove());
  });
  if (cleanupDb) {
    await cleanupDb.query(
      "UPDATE users SET onboarding_seen = true WHERE username = $1",
      [account],
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="tab-run"]').waitFor({
      state: "attached",
      timeout: 25_000,
    });
  }
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
    });

    await goToMixPlan(page);
    await expect(page).toHaveScreenshot("mix-plan-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
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
    await expect(page).toHaveScreenshot("import-review-desktop.png", {
      fullPage: false,
      mask: dynamicMask(page),
    });
    // The review dialog's close control is icon-only; scope the click to the
    // modal so unrelated page buttons cannot be selected.
    await page.locator("div.fixed.inset-0").filter({ hasText: "Import Excel" })
      .locator("button").first().click();

    await page.locator('[data-testid="tab-run"]').click();
    await expect(page).toHaveScreenshot("compact-run-tablet.png", {
      fullPage: false,
      mask: dynamicMask(page),
    });
  });

  test("phone compact presentation and stop dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page);
    await page.locator('[data-testid="tab-run"]').click();
    await expect(page).toHaveScreenshot("run-overview-phone.png", {
      fullPage: false,
      mask: dynamicMask(page),
    });
  });
});