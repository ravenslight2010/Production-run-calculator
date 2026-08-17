/**
 * E2E: Mix Plan — prep card suppression and ended-run removal
 *
 * Two behaviours verified end-to-end that unit tests cannot reach:
 *
 *   (a) A prep mix card is absent when no active run on the selected day
 *       lists any of the prep mix's component ingredients in its profile.
 *       buildMixPlan() returns [] → the empty-state message shows instead.
 *
 *   (b) A mix card disappears from the Make Day plan once the manager clicks
 *       STOP RUN. liveRunsForMixes filters on !r.endedAt (home.tsx ~14463),
 *       so ended runs are excluded and the plan collapses to empty.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/pages/home.tsx  — mix plan section, ~14402–14700
 *     • liveRunsForMixes filter: line ~14462–14467
 *     • buildMixPlan call: line ~14484
 *     • data-testid="mix-plan-empty": line ~14487
 *     • data-testid="mix-plan-{date}": line ~14498
 *     • data-testid="mix-make-day": line ~14398
 *   lib/mixes/src/index.ts          — buildMixPlan, prep-mix filtering logic
 *   artifacts/api-server/src/routes/mixes.ts — POST /api/mixes
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://<dev-domain> \
 *   STAFF_SIGNUP_CODE=<code> \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *   DATABASE_URL=<connection-string> \
 *   pnpm --filter @workspace/run-calculator exec playwright test mix-plan
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2emp${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

/**
 * Sign up via the browser form, then dismiss the "Get Started" onboarding
 * dialog that always auto-opens on a first login. Mirrors the pattern in
 * compact-run-strip.spec.ts which established this is the reliable way to
 * reach the main app without a blocking overlay.
 */
async function signUpAndDismissOnboarding(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(SIGNUP_CODE);
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();

  // Wait for the main app bottom-nav to confirm the app has mounted.
  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

  // The "Get Started" onboarding dialog always auto-opens on a first login and
  // has a modal overlay that intercepts ALL pointer events. Click through it.
  const getStartedBtn = page.getByRole("button", { name: /^get.?started$/i });
  await getStartedBtn.waitFor({ state: "visible", timeout: 10_000 });
  await getStartedBtn.click();

  // Wait for the overlay to detach before any further interactions.
  await page
    .locator('[data-state="open"][aria-hidden="true"]')
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  await page.waitForTimeout(300);
}

/** Navigate to the Mixes tab via the hamburger "More" menu. */
async function goToMixes(page: Page): Promise<void> {
  const menuBtn = page.locator('button[title="More"]');
  await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
  await menuBtn.click();
  const mixesItem = page.getByRole("menuitem", { name: /^mixes$/i });
  await mixesItem.waitFor({ state: "visible", timeout: 5_000 });
  await mixesItem.click();
  // The make-day picker confirms the Mixes tab has rendered.
  await page
    .locator('[data-testid="mix-make-day"]')
    .waitFor({ state: "visible", timeout: 8_000 });
}

/**
 * Insert a mix directly into the DB, bypassing the API capability check.
 * Uses the same "live" scope the web app always queries.
 */
async function dbCreateMix(
  db: Client,
  opts: {
    id: string;
    name: string;
    brand?: string;
    isPrep?: boolean;
    component: string;
    perPizza?: number;
    batchSize?: number;
  },
): Promise<void> {
  const components = JSON.stringify([
    { ingredient: opts.component, perPizza: opts.perPizza ?? 2.0 },
  ]);
  await db.query(
    `INSERT INTO mixes
       (id, scope, name, brand, flavor, batch_size, days_early, notes,
        amount_already_made, components, is_prep, enabled, created_at, updated_at)
     VALUES ($1, 'live', $2, $3, '', $4, 0, '', 0, $5::jsonb, $6, true, NOW(), NOW())
     ON CONFLICT (id, scope) DO UPDATE
       SET name=$2, brand=$3, batch_size=$4, components=$5::jsonb,
           is_prep=$6, updated_at=NOW()`,
    [
      opts.id,
      opts.name,
      opts.brand ?? "",
      opts.batchSize ?? 0,
      components,
      opts.isPrep ?? false,
    ],
  );
}

/** Today's date as YYYY-MM-DD (matches the format buildMixPlan uses for groups). */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── DB lifecycle ──────────────────────────────────────────────────────────────

let db: Client;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

test.afterAll(async () => {
  await db.end();
});

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("Mix Plan — prep card suppression and ended-run removal", () => {
  /**
   * Test (a): Prep mix card is absent when no run on the day uses the ingredient.
   *
   * Mechanism: buildMixPlan only includes prep mixes whose component names match
   * at least one run's ingredient list. A fresh account has only a blank seeded
   * placeholder run (no brand, no ingredients) — so the plan is empty and the
   * prep card never appears.
   */
  test("prep mix card is absent when no active run lists its component ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-mix-${suffix}`;
    const mixName = `HerbPrepMix ${suffix}`;
    const ingredient = `HerbIngredient_${suffix}`;

    try {
      // Insert the prep mix BEFORE the browser loads so the useMixes fetch sees
      // it when the Mixes tab opens.
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: 1.5,
      });

      // Sign up via browser and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Brief pause for startup async effects (useMixes fetch, etc.).
      await page.waitForTimeout(1_000);

      // Navigate to the Mixes tab (make-day defaults to today).
      await goToMixes(page);

      // Allow the React mix plan calculation to settle.
      await page.waitForTimeout(500);

      // The prep mix component ingredient must NOT appear anywhere on the page.
      // buildMixPlan returns [] when no run's ingredient list matches, so the
      // whole plan is empty and the "Ingredient Prep" section is never rendered.
      await expect(page.getByText(ingredient, { exact: true })).toHaveCount(0, {
        timeout: 5_000,
      });

      // The mix name itself must also be absent.
      await expect(page.getByText(mixName, { exact: false })).toHaveCount(0, {
        timeout: 3_000,
      });

      // The empty-state message must be visible, confirming the plan computed
      // correctly (not that the tab failed to load).
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (b): Mix card disappears from the plan after the run is marked ended.
   *
   * Mechanism: liveRunsForMixes (home.tsx ~14462) filters dayState.runs by
   * `r.brand && !r.endedAt`. Once STOP RUN sets r.endedAt, the run is excluded
   * and buildMixPlan returns [] — the plan collapses to empty.
   */
  test("mix card disappears from the plan after the run is marked ended", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `run-mix-${suffix}`;
    const mixName = `RunMix ${suffix}`;
    const component = `Component_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    try {
      // Create the mix with the SAME brand that we'll set on the run form.
      // buildMixPlan matches on exact productKey(brand, flavor), so brand must
      // agree — an empty-brand mix only matches empty-brand runs (which are
      // filtered out of liveRunsForMixes since they have no brand set).
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        brand,
        isPrep: false,
        component,
        perPizza: 2.0,
        batchSize: 10,
      });

      // Sign up via browser and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Brief pause for startup async effects (useMixes fetch, etc.).
      await page.waitForTimeout(1_000);

      // ── Step 1: Set the brand on the run form ──────────────────────────────
      // A run with r.brand set and !r.endedAt is included in liveRunsForMixes.
      // The blank seeded placeholder run has no brand, so we must set one.
      await page.locator('[data-testid="tab-run"]').click();

      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand);

      // Press Enter to add the new brand (onKeyDown handler calls addBrand).
      await brandInput.press("Enter");

      // Brief settle — setRunBrandFlavor updates dayState synchronously but
      // React needs one render cycle before the brand is reflected in the run.
      await page.waitForTimeout(800);

      // ── Step 2: Confirm the mix card is shown on the Mixes tab ────────────
      await goToMixes(page);

      // The plan group card for today must be present.
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // The mix name must be visible inside the group card.
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible();

      // ── Step 3: Start the run so we can stop it ────────────────────────────
      await page.locator('[data-testid="tab-run"]').click();

      const startBtn = page.locator('[data-testid="button-start-run"]');
      await startBtn.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn.click();

      // Wait for the run to enter "running" state — STOP RUN button appears.
      const stopBtn = page.getByRole("button", { name: /stop run/i });
      await stopBtn.waitFor({ state: "visible", timeout: 10_000 });

      // ── Step 4: Stop the run ───────────────────────────────────────────────
      await stopBtn.click();

      // Allow endRun() to update dayState (synchronous localStorage write) and
      // React to flush the state change before we navigate away.
      await page.waitForTimeout(800);

      // ── Step 5: Verify the mix card is gone from the Mixes tab ────────────
      await goToMixes(page);

      // The ended run is excluded from liveRunsForMixes, so buildMixPlan
      // receives an empty runs array and returns []. No group card for today.
      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toHaveCount(0, { timeout: 5_000 });

      // The empty-state message confirms the plan rendered correctly (not crashed).
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });
});
