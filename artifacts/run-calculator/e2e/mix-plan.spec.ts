/**
 * E2E: Mix Plan — prep card suppression, ended-run removal, and pull quantities
 *
 * Three behaviours verified end-to-end that unit tests cannot reach:
 *
 *   (a) A prep mix card is absent when no active run on the selected day
 *       lists any of the prep mix's component ingredients in its profile.
 *       buildMixPlan() returns [] → the empty-state message shows instead.
 *
 *   (b) A mix card disappears from the Make Day plan once the manager clicks
 *       STOP RUN. liveRunsForMixes filters on !r.endedAt (home.tsx ~14463),
 *       so ended runs are excluded and the plan collapses to empty.
 *
 *   (c) A prep mix card shows correct "Pull For Prep" quantities when a run
 *       DOES list the component ingredient. The displayed lbs must equal
 *       (ozPerPizza × totalPizzasForSauce) ÷ 16. buildMixPlan resolves the
 *       per-component lbs from the run's ingredientOzPerPizza map (home.tsx
 *       ~14422–14463), and computeEntryFromComponentLbs derives totalLbs with
 *       a 15 % waste buffer and a flat 20 lb startup add. When amountAlreadyMade
 *       is 0 the Pull For Prep value equals the raw component lbs.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/pages/home.tsx  — mix plan section, ~14402–14700
 *     • liveRunsForMixes filter: line ~14462–14467
 *     • buildMixPlan call: line ~14484
 *     • data-testid="mix-plan-empty": line ~14487
 *     • data-testid="mix-plan-{date}": line ~14498
 *     • data-testid="mix-make-day": line ~14398
 *     • "Ingredient Prep" heading: line ~14625
 *     • "Pull For Prep" heading: line ~14685
 *   lib/mixes/src/index.ts          — buildMixPlan, computeEntryFromComponentLbs
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
    amountAlreadyMade?: number;
  },
): Promise<void> {
  const components = JSON.stringify([
    { ingredient: opts.component, perPizza: opts.perPizza ?? 2.0 },
  ]);
  await db.query(
    `INSERT INTO mixes
       (id, scope, name, brand, flavor, batch_size, days_early, notes,
        amount_already_made, components, is_prep, enabled, created_at, updated_at)
     VALUES ($1, 'live', $2, $3, '', $4, 0, '', $7, $5::jsonb, $6, true, NOW(), NOW())
     ON CONFLICT (id, scope) DO UPDATE
       SET name=$2, brand=$3, batch_size=$4, components=$5::jsonb,
           is_prep=$6, amount_already_made=$7, updated_at=NOW()`,
    [
      opts.id,
      opts.name,
      opts.brand ?? "",
      opts.batchSize ?? 0,
      components,
      opts.isPrep ?? false,
      opts.amountAlreadyMade ?? 0,
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
   * Test (c): Ending ONE run in a two-run shift keeps the OTHER run's mix card.
   *
   * Mechanism: liveRunsForMixes (home.tsx ~14469) maps dayState.runs filtered by
   * `r.brand && !r.endedAt`. With two branded runs, both produce plan entries.
   * After run-1 is stopped (endedAt set), it is excluded from liveRunsForMixes
   * while run-2 remains. buildMixPlan still receives run-2 and renders its mix —
   * the date-group card stays visible and only run-1's mix name disappears.
   */
  test("ending one run keeps the other run's mix card visible in a multi-run shift", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId1 = `run-mix-a-${suffix}`;
    const mixId2 = `run-mix-b-${suffix}`;
    const mixName1 = `RunMixA ${suffix}`;
    const mixName2 = `RunMixB ${suffix}`;
    const component1 = `CompA_${suffix}`;
    const component2 = `CompB_${suffix}`;
    const brand1 = `BrandA_${suffix}`;
    const brand2 = `BrandB_${suffix}`;
    const today = todayStr();

    try {
      // Create two mixes — one per brand — so each run's active status drives its
      // own mix card independently.
      await dbCreateMix(db, {
        id: mixId1,
        name: mixName1,
        brand: brand1,
        isPrep: false,
        component: component1,
        perPizza: 2.0,
        batchSize: 10,
      });
      await dbCreateMix(db, {
        id: mixId2,
        name: mixName2,
        brand: brand2,
        isPrep: false,
        component: component2,
        perPizza: 2.0,
        batchSize: 10,
      });

      // Sign up and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      // ── Step 1: Set brand on run 1 (the auto-seeded placeholder) ──────────
      await page.locator('[data-testid="tab-run"]').click();

      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand1);
      await brandInput.press("Enter");

      // Allow setRunBrandFlavor to persist brand1 on run 1 before we add run 2.
      await page.waitForTimeout(800);

      // ── Step 2: Add run 2 and set brand2 on it ─────────────────────────────
      // addRun() saves run-1's form values, appends a blank run, and switches
      // currentIndex to the new run — the brand input now belongs to run 2.
      const newRunBtn = page.getByRole("button", { name: /new run/i });
      await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
      await newRunBtn.click();

      // Wait for the new (blank) run to become active.
      await page.waitForTimeout(800);

      const brandInput2 = page.locator('input[placeholder="Brand…"]').first();
      await brandInput2.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput2.click();
      await brandInput2.fill(brand2);
      await brandInput2.press("Enter");

      await page.waitForTimeout(800);

      // ── Step 3: Both mix cards must appear on the Mixes tab ───────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // Both mix names must be present inside the date-group card.
      await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Step 4: Switch to run 1 and start it ──────────────────────────────
      await page.locator('[data-testid="tab-run"]').click();

      // The Prev button switches from run 2 (index 1) back to run 1 (index 0).
      const prevBtn = page.getByRole("button", { name: /prev/i });
      await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
      await prevBtn.click();

      await page.waitForTimeout(600);

      const startBtn = page.locator('[data-testid="button-start-run"]');
      await startBtn.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn.click();

      // ── Step 5: Stop run 1 ─────────────────────────────────────────────────
      const stopBtn = page.getByRole("button", { name: /stop run/i });
      await stopBtn.waitFor({ state: "visible", timeout: 10_000 });
      await stopBtn.click();

      // Allow endRun() to write endedAt on run-1 before we navigate away.
      await page.waitForTimeout(800);

      // ── Step 6: Verify run-2's mix is still visible; run-1's mix is gone ──
      await goToMixes(page);
      await page.waitForTimeout(500);

      // The date-group card must still be present — run 2 is still active.
      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toBeVisible({ timeout: 5_000 });

      // Run-1 ended → its brand is excluded from liveRunsForMixes → mix gone.
      await expect(
        page.getByText(mixName1, { exact: false }),
      ).toHaveCount(0, { timeout: 5_000 });

      // Run-2 is still active → its mix must remain visible.
      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`).getByText(mixName2, {
          exact: false,
        }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
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

  /**
   * Test (d): Per-run breakdown on a prep mix card is correct when two brands
   * share the same ingredient at different oz/pizza.
   *
   * Mechanism:
   *   1. Insert a prep mix with a single shared ingredient (isPrep = true).
   *   2. Sign up (fresh account), then inject localStorage so dayState has two
   *      branded runs that BOTH list the ingredient:
   *        • Run 1 — brand1, oz1 = 2.0, casesNeeded = 100, pizzasPerCase = 8
   *                   → 800 pizzas → contribution = (2.0/16) × 800 = 100.00 lbs
   *        • Run 2 — brand2, oz2 = 1.5, casesNeeded =  50, pizzasPerCase = 8
   *                   → 400 pizzas → contribution = (1.5/16) × 400 =  37.50 lbs
   *   3. Reload so the form initialises from injected localStorage.
   *   4. Navigate to the Mixes tab.
   *   5. Verify:
   *        • "Show run breakdown (2 runs)" toggle is visible
   *        • Clicking it reveals brand1 with 100.00 lbs
   *        • Clicking it reveals brand2 with  37.50 lbs
   *        • Pull For Prep = 100.00 + 37.50 = 137.50 lbs
   *          (amountAlreadyMade = 0 → pull = raw component lbs)
   *
   * This exercises the multi-run aggregation path in buildMixPlan
   * (contributions[] array, lib/mixes/src/index.ts ~line 1057–1115) and the
   * collapsible breakdown toggle in home.tsx (~line 14649).
   */
  test("prep mix card shows correct per-run breakdown when two brands share an ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-breakdown-${suffix}`;
    const mixName = `BreakdownPrepMix ${suffix}`;
    const ingredient = `SharedHerb_${suffix}`;

    // Run 1 values
    const brand1 = `Alpha_${suffix}`;
    const OZ1 = 2.0;
    const CASES1 = 100;
    const PPC = 8; // pizzasPerCase — shared by both runs
    // Run 2 values
    const brand2 = `Beta_${suffix}`;
    const OZ2 = 1.5;
    const CASES2 = 50;

    const pizzas1 = CASES1 * PPC; // 800
    const pizzas2 = CASES2 * PPC; // 400
    const contrib1Lbs = (OZ1 / 16) * pizzas1; // 100.00
    const contrib2Lbs = (OZ2 / 16) * pizzas2; //  37.50
    const pullLbs = contrib1Lbs + contrib2Lbs;  // 137.50

    const today = todayStr();

    try {
      // Insert a brand-less prep mix (isPrep=true) so it matches any run whose
      // profile includes the component ingredient, regardless of brand.
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: 0.1, // low fallback value so any match with run oz is distinguishable
      });

      // Sign up and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // ── Inject two runs into localStorage ─────────────────────────────────
      // The fresh account starts with one seeded placeholder run. We:
      //   • Tag run 1 with brand1 and set its ingredient/oz/case values.
      //   • Append a second run object with brand2 and set its values.
      // Both runs carry the same ingredient name so buildMixPlan's prep-mix pass
      // picks up contributions from both.
      await page.evaluate(
        ({ brand1, brand2, ingredient, oz1, oz2, cases1, cases2, ppc }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;

          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
            currentRunId?: string;
          };
          if (!day.runs || day.runs.length === 0) return;

          // ── Run 1: reuse the existing placeholder ──────────────────────────
          day.runs[0].brand = brand1;
          const runId1 = day.runs[0].id;
          const existing1 = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId1)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId1),
            JSON.stringify({
              ...existing1,
              pep1Type: ingredient,
              pep1OzPerPizza: oz1,
              casesNeeded: cases1,
              pizzasPerCase: ppc,
              casesPerLayer: 0,
            }),
          );

          // ── Run 2: append a new minimal run object ─────────────────────────
          const runId2 = `e2e-run2-${Math.random().toString(36).slice(2, 9)}`;
          day.runs.push({ id: runId2, brand: brand2 });
          localStorage.setItem(
            RUN_KEY(runId2),
            JSON.stringify({
              pep1Type: ingredient,
              pep1OzPerPizza: oz2,
              casesNeeded: cases2,
              pizzasPerCase: ppc,
              casesPerLayer: 0,
            }),
          );

          localStorage.setItem(DAY_KEY, JSON.stringify(day));
        },
        { brand1, brand2, ingredient, oz1: OZ1, oz2: OZ2, cases1: CASES1, cases2: CASES2, ppc: PPC },
      );

      // Reload so the React form initialises from the freshly-written localStorage.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

      // The "Get Started" dialog only auto-opens on first login; handle defensively.
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});

      // Brief pause for startup async effects (useMixes fetch, etc.).
      await page.waitForTimeout(1_000);

      // ── Navigate to the Mixes tab ──────────────────────────────────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      // ── Verify the group card for today is present ─────────────────────────
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // ── Verify "Ingredient Prep" section heading ───────────────────────────
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Verify the mix name is visible ─────────────────────────────────────
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Verify the "Show run breakdown (2 runs)" toggle is visible ─────────
      // This toggle only renders when contributions.length >= 2 (home.tsx ~14649).
      const breakdownBtn = todayCard.getByRole("button", {
        name: /show run breakdown \(2 runs\)/i,
      });
      await expect(breakdownBtn).toBeVisible({ timeout: 5_000 });

      // ── Expand the breakdown ───────────────────────────────────────────────
      await breakdownBtn.click();

      // After clicking, the button text changes to "Hide run breakdown (2 runs)".
      await expect(
        todayCard.getByRole("button", { name: /hide run breakdown \(2 runs\)/i }),
      ).toBeVisible({ timeout: 3_000 });

      // ── Verify brand1 row shows its contribution lbs (100.00) ─────────────
      const contrib1Str = contrib1Lbs.toFixed(2); // "100.00"
      const brand1Row = todayCard
        .locator("div", { has: page.getByText(brand1, { exact: false }) })
        .last();
      const brand1Text = await brand1Row.innerText();
      expect(brand1Text).toContain(contrib1Str);

      // ── Verify brand2 row shows its contribution lbs (37.50) ──────────────
      const contrib2Str = contrib2Lbs.toFixed(2); // "37.50"
      const brand2Row = todayCard
        .locator("div", { has: page.getByText(brand2, { exact: false }) })
        .last();
      const brand2Text = await brand2Row.innerText();
      expect(brand2Text).toContain(contrib2Str);

      // ── Verify Pull For Prep total = sum of both contributions ────────────
      // Pull For Prep = c.lbs × remainingLbs / totalLbs.
      // With amountAlreadyMade = 0 → remainingLbs = totalLbs → pull = c.lbs = 137.50.
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      const pullStr = pullLbs.toFixed(2); // "137.50"
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const ingredientRowText = await ingredientRow.innerText();
      expect(ingredientRowText).toContain(pullStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (c): Prep mix card shows correct "Pull For Prep" quantities when a run
   * DOES list the component ingredient.
   *
   * Mechanism:
   *   1. Insert a prep mix with a unique ingredient name and a known perPizza oz.
   *   2. Sign up (fresh account), then inject localStorage run values so the
   *      current placeholder run has:
   *        • a brand (so it passes the liveRunsForMixes brand filter)
   *        • pep1Type = the ingredient name, pep1OzPerPizza = 2.0
   *        • casesNeeded = 100, pizzasPerCase = 8, casesPerLayer = 0
   *      so that valsToMixRun produces ingredientOzPerPizza[ingredient] = 2.0
   *      and totalPizzasForSauce = 100 × 8 = 800 pizzas.
   *   3. Reload the page so the form initialises from the injected localStorage.
   *   4. Navigate to Mixes tab (make-day = today).
   *   5. Verify:
   *        • "Ingredient Prep" section heading is visible
   *        • The prep mix name appears inside the group card
   *        • "Pull For Prep" heading is visible
   *        • The displayed lbs = (2.0 / 16) × 800 = 100.00 lbs
   *          (amountAlreadyMade = 0 → remainingLbs = totalLbs →
   *           pull = c.lbs × 1 = component lbs = 100.00 lbs)
   *
   * Formula reference (lib/mixes/src/index.ts, computeEntryFromComponentLbs):
   *   componentLbs = (ozPerPizza / OZ_PER_LB) × pizzas
   *   totalLbs     = componentLbs × 1.15 + 20   (waste + startup)
   *   remainingLbs = totalLbs − amountAlreadyMade
   *   pull display = c.lbs × remainingLbs / totalLbs = c.lbs when remaining=total
   */
  test("prep mix card shows correct pull quantities when a run uses its ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-pull-${suffix}`;
    const mixName = `PullPrepMix ${suffix}`;
    // Use a unique ingredient name that won't collide with any default form value.
    const ingredient = `TestHerb_${suffix}`;

    // Known recipe values — kept as constants so the expected lbs formula is
    // easy to read and verify.
    //
    // IMPORTANT: MIX_CARD_OZ and RUN_OZ are intentionally different.
    // buildMixPlan prefers the run's profile oz/pizza (ingredientOzPerPizza)
    // over the mix card's generic perPizza. If the code ignores the run-profile
    // value and falls back to the mix-card value, the displayed lbs will be
    // (0.5/16)×800 = 25.00, not 100.00 — so the assertion distinguishes both
    // paths and a regression in the ingredientOzPerPizza lookup fails the test.
    const MIX_CARD_OZ = 0.5;  // fallback perPizza on the mix card (low/wrong value)
    const RUN_OZ = 2.0;        // actual oz/pizza from the run's profile (correct)
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const CASES_PER_LAYER = 0;
    const totalPizzasForSauce = CASES_NEEDED * PIZZAS_PER_CASE + CASES_PER_LAYER * PIZZAS_PER_CASE;
    // Pull for prep = component lbs (when amountAlreadyMade = 0).
    // Expected uses RUN_OZ, not MIX_CARD_OZ.
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzasForSauce; // 100.00

    // The brand string just needs to be non-empty so the run passes the
    // liveRunsForMixes filter (`r.brand && !r.endedAt`).
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    try {
      // Insert the prep mix BEFORE the browser loads.
      // Use MIX_CARD_OZ (0.5) as the fallback perPizza on the mix card. If the
      // code ignores the run's ingredientOzPerPizza and falls back to this value,
      // the displayed lbs will be 25.00 rather than 100.00, failing the assertion.
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: MIX_CARD_OZ,
      });

      // Sign up and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // ── Inject run values into localStorage ────────────────────────────────
      // The current run uses `form.getValues()` live (home.tsx ~14472), which is
      // seeded from localStorage on mount. Injecting here and reloading gives the
      // form the values we want without driving the full UI.
      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase, casesPerLayer }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;

          // Read the existing dayState to find the current run id.
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
            currentRunId?: string;
          };
          if (!day.runs || day.runs.length === 0) return;

          // Tag the first run with a brand so liveRunsForMixes includes it.
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));

          // Write the run values so valsToMixRun produces the expected ingredient map.
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer,
            }),
          );
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE, casesPerLayer: CASES_PER_LAYER },
      );

      // Reload so the React form initialises from the freshly-written localStorage.
      await page.reload({ waitUntil: "domcontentloaded" });

      // Wait for the main app bottom-nav to confirm the app has remounted.
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

      // The "Get Started" dialog only auto-opens ONCE per account (first login).
      // On reload it should not appear; handle it defensively just in case.
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});

      // Brief pause for startup async effects (useMixes fetch, etc.).
      await page.waitForTimeout(1_000);

      // ── Navigate to the Mixes tab ──────────────────────────────────────────
      await goToMixes(page);

      // Allow the React mix plan calculation to settle.
      await page.waitForTimeout(500);

      // ── Verify the group card for today is present ─────────────────────────
      // A prep mix that matches a live run creates a group even when there are no
      // brand/flavor mixes — see buildMixPlan returning groups with prepMixes only.
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // ── Verify the "Ingredient Prep" section heading ───────────────────────
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Verify the mix name is visible inside the card ─────────────────────
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Verify the "Pull For Prep" section heading ─────────────────────────
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Verify the ingredient row shows the correct pull lbs ───────────────
      // The displayed value uses fmtNum(lbs, 2) → "100.00".
      // We assert the ingredient name is visible inside the Pull For Prep section.
      await expect(todayCard.getByText(ingredient, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // Locate the ingredient row in the Pull For Prep section and read its text.
      // The row is a flex div containing the ingredient name span and a lbs span.
      // Using { has } scopes the locator to the div that directly contains the
      // ingredient name so we read only the relevant row, not the whole card.
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      // Expected: run-profile lbs = (RUN_OZ / 16) × totalPizzasForSauce = 100.00
      const expectedStr = expectedPullLbs.toFixed(2); // "100.00"
      // Wrong fallback: mix-card lbs = (MIX_CARD_OZ / 16) × totalPizzasForSauce = 25.00
      const wrongFallbackStr = ((MIX_CARD_OZ / 16) * totalPizzasForSauce).toFixed(2); // "25.00"

      expect(rowText).toContain(expectedStr);
      // If the code ignores ingredientOzPerPizza and uses the mix-card perPizza
      // instead, it would display 25.00 — asserting the fallback is absent
      // proves the run-profile lookup path was exercised.
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (d): Pull For Prep quantity is reduced proportionally when some of the
   * mix is already made (amountAlreadyMade > 0 but < totalLbs).
   *
   * Formula (lib/mixes/src/index.ts, computeEntryFromComponentLbs):
   *   componentLbs = (runOz / 16) × totalPizzas          → 100.00 lbs
   *   totalLbs     = componentLbs × 1.15 + 20             → 135.00 lbs
   *   remainingLbs = totalLbs − amountAlreadyMade          →  85.00 lbs
   *   pull display = c.lbs × remainingLbs / totalLbs
   *                = 100.00 × 85.00 / 135.00              →  62.96 lbs
   *
   * The displayed value must be strictly less than the full componentLbs
   * (100.00), proving the already-made subtraction is applied before rendering.
   */
  test("Pull For Prep is reduced proportionally when some of the mix is already made", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-partial-${suffix}`;
    const mixName = `PartialPrepMix ${suffix}`;
    const ingredient = `PartialHerb_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    // Recipe constants.
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800

    // Expected math.
    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const AMOUNT_ALREADY_MADE = 50;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;           // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00
    const remainingLbs = totalLbs - AMOUNT_ALREADY_MADE;          // 85.00
    const expectedPullLbs = componentLbs * remainingLbs / totalLbs; // 62.96...
    const expectedStr = expectedPullLbs.toFixed(2);               // "62.96"
    const fullStr = componentLbs.toFixed(2);                       // "100.00"

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: AMOUNT_ALREADY_MADE,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject run values into localStorage so the form has the expected recipe.
      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
          };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer: 0,
            }),
          );
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // "Ingredient Prep" heading and mix name must be visible.
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      // "Pull For Prep" heading must be visible.
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      // The ingredient row must show the reduced lbs, not the full componentLbs.
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      // Displayed value must equal the proportionally-reduced amount.
      expect(rowText).toContain(expectedStr);
      // Full componentLbs must NOT appear — that would mean the already-made
      // subtraction was silently skipped.
      expect(rowText).not.toContain(fullStr);

      // ── Verify the "need X lbs" badge next to totalLbs ────────────────────
      // The badge renders when remainingLbs < totalLbs (home.tsx ~line 14646):
      //   {m.remainingLbs < m.totalLbs && <span>need {fmtNum(m.remainingLbs, 2)} lbs</span>}
      // remainingLbs = totalLbs − amountAlreadyMade = 135.00 − 50 = 85.00
      // so the badge must read "need 85.00 lbs".
      const remainingStr = remainingLbs.toFixed(2); // "85.00"
      await expect(
        todayCard.getByText(`need ${remainingStr} lbs`, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (e): Pull For Prep shows 0.00 lbs when amountAlreadyMade >= totalLbs
   * (the batch is fully covered). The card itself must still be visible so staff
   * can confirm coverage; only the pull quantity must be zero.
   *
   * Formula:
   *   remainingLbs = max(0, totalLbs − amountAlreadyMade) = max(0, 135 − 200) = 0
   *   pull display = c.lbs × 0 / totalLbs = 0.00
   */
  test("Pull For Prep shows 0.00 lbs when the mix is fully covered by amountAlreadyMade", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-full-${suffix}`;
    const mixName = `FullCoveredPrepMix ${suffix}`;
    const ingredient = `CoveredHerb_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    // Set amountAlreadyMade well above totalLbs (135.00) to guarantee full coverage.
    const AMOUNT_ALREADY_MADE = 200;

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: AMOUNT_ALREADY_MADE,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
          };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer: 0,
            }),
          );
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      // The card must still appear — fully-covered cards are kept so staff can
      // confirm coverage (line 14618–14622 comment in home.tsx).
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      // Pull quantity must be 0.00 — remainingLbs = max(0, 135 − 200) = 0.
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      expect(rowText).toContain("0.00");

      // ── Verify the "need X lbs" badge is present and reads "need 0.00 lbs" ──
      // The badge renders when remainingLbs < totalLbs (home.tsx ~line 14646):
      //   {m.remainingLbs < m.totalLbs && <span>need {fmtNum(m.remainingLbs, 2)} lbs</span>}
      // remainingLbs = max(0, 135 − 200) = 0 and totalLbs = 135 → 0 < 135 is true
      // so the badge must still appear and must read "need 0.00 lbs".
      // This confirms fully-covered cards are not hidden and the badge fires on the
      // `remainingLbs < totalLbs` condition rather than `remainingLbs > 0`.
      await expect(
        todayCard.getByText("need 0.00 lbs", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (g): 'need X lbs' badge on a prep mix card updates immediately when
   * the manager edits the 'Already made' field.
   *
   * Mechanism:
   *   • The badge renders in home.tsx (~line 14646):
   *       {m.remainingLbs < m.totalLbs && <span>need {fmtNum(m.remainingLbs, 2)} lbs</span>}
   *   • MixAlreadyMadeInput saves on blur (onBlur → saveMixes → onSaved).
   *   • onSaved calls cycleCountQc.setQueryData(["mixes"], saved), which updates
   *     the `mixes` React-Query cache. Home.tsx uses the live `mixes` array to
   *     find the mix record (home.tsx ~14677) and passes it to buildMixPlan, so
   *     remainingLbs re-computes from the new amountAlreadyMade on the next render.
   *
   * Formula (lib/mixes/src/index.ts, computeEntryFromComponentLbs):
   *   componentLbs = (RUN_OZ / 16) × totalPizzas     → 100.00 lbs
   *   totalLbs     = componentLbs × 1.15 + 20         → 135.00 lbs
   *   After typing 50:
   *     remainingLbs = 135.00 − 50 = 85.00            → badge "need 85.00 lbs"
   *   After clearing to 0:
   *     remainingLbs = 135.00 = totalLbs              → badge absent
   */
  test("'need X lbs' badge updates immediately when 'already made' is edited", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `badge-live-${suffix}`;
    const mixName = `BadgeLivePrepMix ${suffix}`;
    const ingredient = `BadgeHerb_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    // Recipe constants — same as existing pull tests so the formulas are verifiable.
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;                        // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS;    // 135.00

    const EDIT_AMOUNT = 50;
    const remainingAfterEdit = totalLbs - EDIT_AMOUNT;                        // 85.00
    const remainingStr = remainingAfterEdit.toFixed(2);                       // "85.00"

    try {
      // Create the prep mix with amountAlreadyMade = 0 so the badge is initially
      // absent (remainingLbs == totalLbs → condition false).
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: 0,
      });

      // Sign up and dismiss onboarding.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject run values into localStorage so the mix card appears.
      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
          };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer: 0,
            }),
          );
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      // Reload so the form initialises from the injected localStorage.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});
      await page.waitForTimeout(1_000);

      // Navigate to the Mixes tab.
      await goToMixes(page);
      await page.waitForTimeout(500);

      // Confirm the mix card is present.
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      // ── Step 1: Badge must be absent before any edit ───────────────────────
      // amountAlreadyMade = 0 → remainingLbs = totalLbs → condition false.
      await expect(
        todayCard.getByText(/need .+ lbs/, { exact: false }),
      ).toHaveCount(0, { timeout: 3_000 });

      // ── Step 2: Type 50 into the "Already made" input and blur ────────────
      // MixAlreadyMadeInput saves on blur via onBlur → saveMixes → onSaved.
      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill(String(EDIT_AMOUNT));
      // Tab away to trigger onBlur → save.
      await alreadyMadeInput.press("Tab");

      // Give the save round-trip and React re-render time to complete.
      await page.waitForTimeout(1_500);

      // ── Step 3: Badge must now show "need 85.00 lbs" ──────────────────────
      // remainingLbs = totalLbs − 50 = 135.00 − 50 = 85.00
      // The badge span text: `need ${fmtNum(remainingLbs, 2)} lbs`
      await expect(
        todayCard.getByText(`need ${remainingStr} lbs`, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ── Step 4: Clear the field back to 0 and blur ────────────────────────
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill("0");
      await alreadyMadeInput.press("Tab");

      // Give the save round-trip and React re-render time to complete.
      await page.waitForTimeout(1_500);

      // ── Step 5: Badge must disappear again ────────────────────────────────
      // amountAlreadyMade = 0 → remainingLbs = totalLbs → condition false.
      await expect(
        todayCard.getByText(/need .+ lbs/, { exact: false }),
      ).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (f): Mix plan collapses to empty when ALL runs in a shift are ended.
   *
   * Mechanism: liveRunsForMixes (home.tsx ~14469) filters dayState.runs by
   * `r.brand && !r.endedAt`. With two branded runs, both produce plan entries.
   * After run-1 is stopped the date-group card still exists because run-2 is live.
   * Once run-2 is also stopped, liveRunsForMixes produces an empty array, so
   * buildMixPlan returns [] — the plan collapses entirely and the empty-state
   * message appears. Neither mix name should remain visible.
   */
  test("mix plan collapses to empty when all runs in a shift are ended", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId1 = `all-ended-mix-a-${suffix}`;
    const mixId2 = `all-ended-mix-b-${suffix}`;
    const mixName1 = `AllEndedMixA ${suffix}`;
    const mixName2 = `AllEndedMixB ${suffix}`;
    const component1 = `AllEndedCompA_${suffix}`;
    const component2 = `AllEndedCompB_${suffix}`;
    const brand1 = `AllEndedBrandA_${suffix}`;
    const brand2 = `AllEndedBrandB_${suffix}`;
    const today = todayStr();

    try {
      // Create two mixes — one per brand — so each run's active status drives
      // its own mix card independently.
      await dbCreateMix(db, {
        id: mixId1,
        name: mixName1,
        brand: brand1,
        isPrep: false,
        component: component1,
        perPizza: 2.0,
        batchSize: 10,
      });
      await dbCreateMix(db, {
        id: mixId2,
        name: mixName2,
        brand: brand2,
        isPrep: false,
        component: component2,
        perPizza: 2.0,
        batchSize: 10,
      });

      // Sign up and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      // ── Step 1: Set brand on run 1 (the auto-seeded placeholder) ──────────
      await page.locator('[data-testid="tab-run"]').click();

      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand1);
      await brandInput.press("Enter");

      // Allow setRunBrandFlavor to persist brand1 on run 1 before adding run 2.
      await page.waitForTimeout(800);

      // ── Step 2: Add run 2 and set brand2 on it ─────────────────────────────
      const newRunBtn = page.getByRole("button", { name: /new run/i });
      await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
      await newRunBtn.click();

      // Wait for the new (blank) run to become active.
      await page.waitForTimeout(800);

      const brandInput2 = page.locator('input[placeholder="Brand…"]').first();
      await brandInput2.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput2.click();
      await brandInput2.fill(brand2);
      await brandInput2.press("Enter");

      await page.waitForTimeout(800);

      // ── Step 3: Confirm both mix cards appear on the Mixes tab ────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({
        timeout: 5_000,
      });
      await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── Step 4: Switch to run 1 and start + stop it ────────────────────────
      await page.locator('[data-testid="tab-run"]').click();

      // The Prev button switches from run 2 (index 1) back to run 1 (index 0).
      const prevBtn = page.getByRole("button", { name: /prev/i });
      await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
      await prevBtn.click();

      await page.waitForTimeout(600);

      const startBtn1 = page.locator('[data-testid="button-start-run"]');
      await startBtn1.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn1.click();

      const stopBtn1 = page.getByRole("button", { name: /stop run/i });
      await stopBtn1.waitFor({ state: "visible", timeout: 10_000 });
      await stopBtn1.click();

      // Allow endRun() to write endedAt on run-1.
      await page.waitForTimeout(800);

      // ── Step 5: After stopping run 1, the date-group card is still present ─
      // because run-2 is still active. Confirm mixName2 remains visible — this
      // also verifies we are testing the right code path (not a load failure).
      await goToMixes(page);
      await page.waitForTimeout(500);

      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toBeVisible({ timeout: 5_000 });

      // ── Step 6: Switch to run 2 and start + stop it ────────────────────────
      await page.locator('[data-testid="tab-run"]').click();

      // After stopping run 1 the app stays on run 1; the Next button advances
      // to run 2 (index 1). If Next is absent (already on the last run) we fall
      // back to clicking New Run — but two runs were created so Next must exist.
      const nextBtn = page.getByRole("button", { name: /next/i });
      await nextBtn.waitFor({ state: "visible", timeout: 8_000 });
      await nextBtn.click();

      await page.waitForTimeout(600);

      const startBtn2 = page.locator('[data-testid="button-start-run"]');
      await startBtn2.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn2.click();

      const stopBtn2 = page.getByRole("button", { name: /stop run/i });
      await stopBtn2.waitFor({ state: "visible", timeout: 10_000 });
      await stopBtn2.click();

      // Allow endRun() to write endedAt on run-2.
      await page.waitForTimeout(800);

      // ── Step 7: Both runs ended → plan must be empty ───────────────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      // No date-group card: liveRunsForMixes is now empty so buildMixPlan
      // returns [] and the group never renders.
      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toHaveCount(0, { timeout: 5_000 });

      // The empty-state message must be visible, confirming the plan computed
      // correctly (not that the tab failed to render).
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });

      // Neither mix name should appear anywhere on the page.
      await expect(
        page.getByText(mixName1, { exact: false }),
      ).toHaveCount(0, { timeout: 3_000 });
      await expect(
        page.getByText(mixName2, { exact: false }),
      ).toHaveCount(0, { timeout: 3_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (g): Prep mix card appears when a run profile uses a QUALIFIED
   * ingredient name (e.g. "Herb - Dried") whose base name matches the mix
   * component "Herb".
   *
   * Mechanism: ingredientMatches() in lib/mixes/src/index.ts (~line 1002–1011)
   * treats two names as equivalent when the shorter is a word-boundary prefix of
   * the longer. "Herb" is a prefix of "Herb - Dried" and the next character is a
   * space, so the match returns true and the prep mix card is included in the plan.
   *
   * Without this prefix logic a run using "Herb - Dried" would never match a mix
   * component named "Herb" and the card would be silently suppressed.
   *
   * This test verifies:
   *   1. The date-group card appears (prefix match succeeded).
   *   2. The "Ingredient Prep" and "Pull For Prep" headings are visible.
   *   3. The displayed lbs = (RUN_OZ / 16) × totalPizzas — non-zero and
   *      distinct from the mix-card fallback, proving ingredientOzPerPizza was
   *      resolved via the same ingredientMatches() path.
   */
  test("prep mix card appears when run uses a qualified ingredient name matching the mix component base name", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-prefix-${suffix}`;
    const mixName = `PrefixPrepMix ${suffix}`;

    // Short base name stored on the mix component.
    const componentBase = `Herb_${suffix}`;
    // Qualified name stored in the run profile — a common spec-import pattern.
    const qualifiedIngredient = `${componentBase} - Dried`;

    const brand = `Brand_${suffix}`;
    const today = todayStr();

    // Recipe constants — chosen so the expected lbs is unambiguously non-zero
    // and distinct from any default/fallback value.
    const RUN_OZ = 3.0;
    const CASES_NEEDED = 80;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 640
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 120.00

    // Use a clearly-wrong fallback so a regression in the prefix-match is visible.
    const MIX_CARD_OZ = 0.1; // fallback perPizza on the mix card (distinguishably low)
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 4.00

    try {
      // Insert the prep mix with the SHORT base name as the component.
      // The run will list the QUALIFIED name — the prefix logic must bridge them.
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: componentBase,
        perPizza: MIX_CARD_OZ,
      });

      // Sign up and dismiss the onboarding dialog.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // ── Inject run values into localStorage ────────────────────────────────
      // Tag the seeded placeholder run with a brand (so it passes the
      // liveRunsForMixes filter) and set pep1Type to the QUALIFIED ingredient
      // name ("Herb_<suffix> - Dried"). ingredientMatches() must recognise this
      // as matching the mix component base name ("Herb_<suffix>").
      await page.evaluate(
        ({ brand, qualifiedIngredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;

          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
          };
          if (!day.runs || day.runs.length === 0) return;

          // Brand the first (placeholder) run so liveRunsForMixes includes it.
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));

          // Write the run values — pep1Type is the QUALIFIED name.
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: qualifiedIngredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer: 0,
            }),
          );
        },
        { brand, qualifiedIngredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      // Reload so the React form initialises from the freshly-written localStorage.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

      // The "Get Started" dialog only auto-opens on first login; handle defensively.
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});

      // Brief pause for startup async effects (useMixes fetch, etc.).
      await page.waitForTimeout(1_000);

      // ── Navigate to the Mixes tab ──────────────────────────────────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      // ── 1. Date-group card must be present ────────────────────────────────
      // The prefix match "Herb_<suffix>" ⊆ "Herb_<suffix> - Dried" must fire so
      // buildMixPlan includes this prep mix in the today group.
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      // ── 2. "Ingredient Prep" section heading must be visible ───────────────
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── 3. Mix name must appear inside the card ────────────────────────────
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── 4. "Pull For Prep" heading must be visible ─────────────────────────
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ── 5. Pull lbs must equal the run-profile value, not the fallback ─────
      // The ingredient row is found by the BASE component name (which the mix
      // card renders) and its text must contain the expected lbs string.
      await expect(todayCard.getByText(componentBase, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(componentBase, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2);       // "120.00"
      const wrongFallbackStr = wrongFallbackLbs.toFixed(2); //   "4.00"

      // Correct: run-profile oz resolved via ingredientMatches() prefix lookup.
      expect(rowText).toContain(expectedStr);
      // Wrong: mix-card fallback perPizza used (means prefix lookup failed).
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (h): Pull For Prep quantity updates immediately when a manager edits
   * the "Already made" field in the UI — without a page reload.
   *
   * This covers the interactive path no other test reaches:
   *   • Page loads with amountAlreadyMade = 0 → full pull = componentLbs.
   *   • Manager types 50 into MixAlreadyMadeInput and blurs.
   *   • MixAlreadyMadeInput.onBlur POSTs the new value, then onSaved calls
   *     cycleCountQc.setQueryData(["mixes"], saved) — updating the React Query
   *     cache. buildMixPlan re-runs and the Pull For Prep lbs on the card drop
   *     without a page reload.
   *   • A second edit of 200 (>= totalLbs 135.00) drives pull to 0.00.
   *
   * Formula (lib/mixes/src/index.ts, computeEntryFromComponentLbs):
   *   componentLbs = (2.0/16) × 800 = 100.00
   *   totalLbs     = 100 × 1.15 + 20 = 135.00
   *
   *   After typing 50 lbs:
   *     remainingLbs = 135.00 − 50 = 85.00
   *     pull = componentLbs × remainingLbs / totalLbs = 100 × 85 / 135 ≈ 62.96
   *
   *   After typing 200 lbs (>= totalLbs):
   *     remainingLbs = max(0, 135 − 200) = 0  →  pull = 0.00
   */
  test("Pull For Prep updates live when the already-made field is edited in the UI", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-live-edit-${suffix}`;
    const mixName = `LiveEditPrepMix ${suffix}`;
    const ingredient = `LiveEditHerb_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    // Recipe constants.
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;                         // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS;     // 135.00

    // Step A — initial state: amountAlreadyMade = 0 → pull = full componentLbs.
    const fullPullStr = componentLbs.toFixed(2); // "100.00"

    // Step B — type 50 lbs partial.
    const PARTIAL_ALREADY_MADE = 50;
    const remainingAfterPartial = totalLbs - PARTIAL_ALREADY_MADE;             // 85.00
    const partialPullLbs = componentLbs * remainingAfterPartial / totalLbs;    // ≈62.96
    const partialPullStr = partialPullLbs.toFixed(2);                          // "62.96"

    // Step C — type 200 lbs (>= totalLbs) → pull = 0.00.
    const FULL_COVERAGE = 200;

    try {
      // Insert the prep mix with amountAlreadyMade = 0 so the initial pull
      // equals the full componentLbs.
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject run values into localStorage so the form has the expected
      // ingredient/oz/case values that drive buildMixPlan.
      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as {
            runs?: Array<{ id: string; brand?: string }>;
          };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try {
              return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}");
            } catch {
              return {};
            }
          })();
          localStorage.setItem(
            RUN_KEY(runId),
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              casesNeeded,
              pizzasPerCase,
              casesPerLayer: 0,
            }),
          );
        },
        {
          brand,
          ingredient,
          runOz: RUN_OZ,
          casesNeeded: CASES_NEEDED,
          pizzasPerCase: PIZZAS_PER_CASE,
        },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="tab-run"]')
        .waitFor({ state: "attached", timeout: 25_000 });
      await page
        .getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 })
        .then((btn) => btn.click())
        .catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      // ── A: Verify initial Pull For Prep = full componentLbs (100.00) ───────
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(
        todayCard.getByText("Ingredient Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        todayCard.getByText(mixName, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        todayCard.getByText("Pull For Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // The ingredient row in Pull For Prep must show the full pull initially.
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      expect(await ingredientRow.innerText()).toContain(fullPullStr);

      // ── B: Type 50 lbs into "Already made" and blur ───────────────────────
      // MixAlreadyMadeInput renders a single <input type="number"> in each prep
      // mix card. One prep mix is on this page so the first number input inside
      // todayCard unambiguously belongs to our mix.
      const alreadyMadeInput = todayCard
        .locator('input[type="number"]')
        .first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.fill(String(PARTIAL_ALREADY_MADE));
      // Blurring fires the onBlur save handler: POSTs to /api/mixes, then
      // onSaved calls cycleCountQc.setQueryData(["mixes"], saved) which updates
      // the React Query cache → buildMixPlan re-runs → Pull For Prep updates.
      await alreadyMadeInput.blur();

      // Allow the save round-trip (network POST + cache update + re-render).
      await page.waitForTimeout(2_500);

      // Pull For Prep must now show the proportionally-reduced amount (≈62.96).
      const partialText = await ingredientRow.innerText();
      expect(partialText).toContain(partialPullStr);
      // Full pull must no longer appear — proving the cache update and
      // buildMixPlan re-run both fired with the new amountAlreadyMade.
      expect(partialText).not.toContain(fullPullStr);

      // ── C: Type 200 lbs (>= totalLbs 135.00) → pull must drop to 0.00 ─────
      await alreadyMadeInput.fill(String(FULL_COVERAGE));
      await alreadyMadeInput.blur();

      // Allow the second save round-trip.
      await page.waitForTimeout(2_500);

      // remainingLbs = max(0, 135 − 200) = 0 → pull display = 0.00.
      const fullCoverageText = await ingredientRow.innerText();
      expect(fullCoverageText).toContain("0.00");
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db
        .query("DELETE FROM users WHERE username = $1", [username])
        .catch(() => {});
    }
  });
});
