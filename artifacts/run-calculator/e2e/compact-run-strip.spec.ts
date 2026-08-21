/**
 * E2E: Ended-run CompactRunStrip survives a Run-tab round-trip
 *
 * Guard verified: `{activeTab !== "run" && <CompactRunStrip />}` in home.tsx
 *
 * Scenario: after a run is ended the strip must remain visible — with "Ended"
 * status and without Pause or Resume buttons — on every non-run tab even after
 * the user has navigated back to the Run tab and away again.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/pages/home.tsx  (line ~11601, ~15131)
 *   artifacts/run-calculator/src/contexts/__tests__/HomeRunSummaryCtx.memo.test.tsx
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://<dev-domain> \
 *   STAFF_SIGNUP_CODE=<code> \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *   DATABASE_URL=<connection-string> \
 *   pnpm --filter @workspace/run-calculator exec playwright test
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers } from "./isolation";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2estrip${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "Welcome2Lucias!";
const testUsernames = new Set<string>();

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

/**
 * Sign up a fresh throwaway account and wait for the main app to be ready.
 * Waits for and dismisses the first-login "Get Started" onboarding dialog,
 * which appears on every new account's first session and would otherwise
 * intercept all pointer events.
 */
async function signUpAndDismissOnboarding(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  // Navigate directly to the sign-up route
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });

  // Wait for the form to be interactive
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });

  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(SIGNUP_CODE);

  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();

  // Wait for the main app to load (Run tab appears in the DOM)
  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

  // On first login a "Get Started" onboarding dialog ALWAYS auto-opens.
  // It has a modal overlay (data-state="open") that intercepts ALL pointer
  // events. Wait for the "Get started" button inside the dialog, then click
  // it so the overlay clears before we interact with anything else.
  const getStartedBtn = page.getByRole("button", { name: /^get.?started$/i });
  await getStartedBtn.waitFor({ state: "visible", timeout: 10_000 });
  await getStartedBtn.click();

  // Wait for the modal overlay to fully exit before any further clicks.
  const overlay = page.locator('[data-state="open"][aria-hidden="true"]');
  await overlay.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {
    // overlay may already be gone; that's fine
  });

  // Small additional wait for any exit animation to complete
  await page.waitForTimeout(300);
}

// ── test ─────────────────────────────────────────────────────────────────────

test.describe("CompactRunStrip — ended-run round-trip", () => {
  test(
    "strip stays visible with Ended status after Run-tab round-trip, no pause/resume buttons",
    async ({ page }) => {
      const username = uid();
      testUsernames.add(username);

      // 1. Sign up, land on the main app, dismiss onboarding dialog
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // 2. Navigate to Run tab and start a run
      await page.locator('[data-testid="tab-run"]').click();
      const startBtn = page.locator('[data-testid="button-start-run"]');
      await startBtn.waitFor({ state: "visible", timeout: 10_000 });
      await startBtn.click();

      // 3. Confirm run is active — STOP RUN button appears
      const stopBtn = page.getByRole("button", { name: /stop.?run/i });
      await stopBtn.waitFor({ state: "visible", timeout: 10_000 });

      // 4. End the run
      await stopBtn.click();

      // 5. Navigate to Dough tab (non-run tab)
      await page.locator('[data-testid="tab-dough"]').click();

      // ── CRITICAL CHECK 1: strip is visible with Ended state ─────────────────
      const strip = page.locator('[data-testid="compact-run-strip"]');
      await strip.waitFor({ state: "visible", timeout: 10_000 });

      await expect(strip).toContainText("Ended", { ignoreCase: true });
      await expect(page.locator('[data-testid="strip-pause"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="strip-resume"]')).toHaveCount(0);

      // ── Round-trip: Dough → Run → Dough ─────────────────────────────────────
      await page.locator('[data-testid="tab-run"]').click();
      // The strip must NOT appear on the Run tab itself
      await expect(page.locator('[data-testid="compact-run-strip"]')).toHaveCount(0);

      await page.locator('[data-testid="tab-dough"]').click();

      // ── CRITICAL CHECK 2: strip still present after round-trip ──────────────
      await strip.waitFor({ state: "visible", timeout: 10_000 });
      await expect(strip).toContainText("Ended", { ignoreCase: true });
      await expect(page.locator('[data-testid="strip-pause"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="strip-resume"]')).toHaveCount(0);

      // ── Extra: confirm strip also appears on the Sauce tab ──────────────────
      await page.locator('[data-testid="tab-sauce"]').click();
      await expect(page.locator('[data-testid="compact-run-strip"]')).toBeVisible();
      await expect(page.locator('[data-testid="strip-pause"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="strip-resume"]')).toHaveCount(0);
    },
  );
});
