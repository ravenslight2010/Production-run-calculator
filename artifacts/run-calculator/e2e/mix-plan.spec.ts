/**
 * E2E: Mix Plan — prep card suppression, ended-run removal, and pull quantities
 *
 * Behaviours verified end-to-end:
 *
 *   (a) A prep mix card is absent when no active run on the selected day
 *       lists any of the prep mix's component ingredients.
 *
 *   (b) A mix card disappears from the Make Day plan once the manager clicks
 *       STOP RUN.
 *
 *   (c) Ending ONE run in a two-run shift keeps the OTHER run's mix card.
 *
 *   (d) A prep mix card shows correct "Pull For Prep" quantities when a run
 *       DOES list the component ingredient (amountAlreadyMade = 0).
 *
 *   (e) Per-run breakdown is correct when two brands share an ingredient
 *       (amountAlreadyMade = 0).
 *
 *   (f) Pull For Prep is reduced proportionally when amountAlreadyMade > 0
 *       (single run).
 *
 *   (g) Pull For Prep shows 0.00 lbs when amountAlreadyMade >= totalLbs.
 *
 *   (h) Pull For Prep is scaled proportionally when TWO runs share an
 *       ingredient and amountAlreadyMade > 0 (Task #764 target).
 *
 *   (i) Badge updates live when the "Already made" input is edited.
 *
 *   (j) Mix plan collapses to empty when ALL runs in a shift are ended.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/pages/home.tsx  — mix plan section, ~14402–14700
 *   lib/mixes/src/index.ts          — buildMixPlan, computeEntryFromComponentLbs
 *   artifacts/api-server/src/routes/mixes.ts — POST /api/mixes
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2emp${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

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

  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });

  const getStartedBtn = page.getByRole("button", { name: /^get.?started$/i });
  await getStartedBtn.waitFor({ state: "visible", timeout: 10_000 });
  await getStartedBtn.click();

  await page
    .locator('[data-state="open"][aria-hidden="true"]')
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});

  await page.waitForTimeout(300);
}

async function goToMixes(page: Page): Promise<void> {
  const menuBtn = page.locator('button[title="More"]');
  await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
  await menuBtn.click();
  const mixesItem = page.getByRole("menuitem", { name: /^mixes$/i });
  await mixesItem.waitFor({ state: "visible", timeout: 5_000 });
  await mixesItem.click();
  await page
    .locator('[data-testid="mix-make-day"]')
    .waitFor({ state: "visible", timeout: 8_000 });
}

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
    daysEarly?: number;
  },
): Promise<void> {
  const components = JSON.stringify([
    { ingredient: opts.component, perPizza: opts.perPizza ?? 2.0 },
  ]);
  await db.query(
    `INSERT INTO mixes
       (id, scope, name, brand, flavor, batch_size, days_early, notes,
        amount_already_made, components, is_prep, enabled, created_at, updated_at)
     VALUES ($1, 'live', $2, $3, '', $4, $8, '', $7, $5::jsonb, $6, true, NOW(), NOW())
     ON CONFLICT (id, scope) DO UPDATE
       SET name=$2, brand=$3, batch_size=$4, components=$5::jsonb,
           is_prep=$6, amount_already_made=$7, days_early=$8, updated_at=NOW()`,
    [
      opts.id,
      opts.name,
      opts.brand ?? "",
      opts.batchSize ?? 0,
      components,
      opts.isPrep ?? false,
      opts.amountAlreadyMade ?? 0,
      opts.daysEarly ?? 0,
    ],
  );
}

/** Format a Date as YYYY-MM-DD using the local calendar (matches app ?today= keying). */
function localDateStr(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function todayStr(): string {
  return localDateStr(new Date());
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
   * Test (a): Prep mix card is absent when no active run lists its component.
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
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: 1.5,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      await expect(page.getByText(ingredient, { exact: true })).toHaveCount(0, {
        timeout: 5_000,
      });
      await expect(page.getByText(mixName, { exact: false })).toHaveCount(0, {
        timeout: 3_000,
      });
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
   * Mechanism: liveRunsForMixes (home.tsx ~14462) filters dayState.runs by
   * `r.brand && !r.endedAt`. Once STOP RUN sets r.endedAt on run-1, run-2
   * (still active) keeps its mix card visible.
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

      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      // Set brand on run 1
      await page.locator('[data-testid="tab-run"]').click();
      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand1);
      await brandInput.press("Enter");

      // Allow setRunBrandFlavor to persist brand1 on run 1 before we add run 2.
      await page.waitForTimeout(800);

      // Add run 2 and set brand2
      const newRunBtn = page.getByRole("button", { name: /new run/i });
      await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
      await newRunBtn.click();
      await page.waitForTimeout(800);

      const brandInput2 = page.locator('input[placeholder="Brand…"]').first();
      await brandInput2.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput2.click();
      await brandInput2.fill(brand2);
      await brandInput2.press("Enter");
      await page.waitForTimeout(800);

      // Both mix cards must appear on the Mixes tab
      await goToMixes(page);
      await page.waitForTimeout(500);
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({ timeout: 5_000 });

      // Switch to run 1 via Prev and start it
      await page.locator('[data-testid="tab-run"]').click();
      const prevBtn = page.getByRole("button", { name: /prev/i });
      await prevBtn.waitFor({ state: "visible", timeout: 8_000 });
      await prevBtn.click();
      await page.waitForTimeout(600);

      const startBtn = page.locator('[data-testid="button-start-run"]');
      await startBtn.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn.click();

      // Stop run 1
      const stopBtn = page.getByRole("button", { name: /stop run/i });
      await stopBtn.waitFor({ state: "visible", timeout: 10_000 });
      await stopBtn.click();

      // Allow endRun() to write endedAt on run-1 before we navigate away.
      await page.waitForTimeout(800);

      // Verify run-2's mix is still visible; run-1's mix is gone
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

      // Set the brand on the run form.
      // A run with r.brand set and !r.endedAt is included in liveRunsForMixes.
      // The blank seeded placeholder run has no brand, so we must set one.
      await page.locator('[data-testid="tab-run"]').click();
      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand);
      await brandInput.press("Enter");
      await page.waitForTimeout(800);

      await goToMixes(page);
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible();

      await page.locator('[data-testid="tab-run"]').click();
      const startBtn = page.locator('[data-testid="button-start-run"]');
      await startBtn.waitFor({ state: "visible", timeout: 8_000 });
      await startBtn.click();

      const stopBtn = page.getByRole("button", { name: /stop run/i });
      await stopBtn.waitFor({ state: "visible", timeout: 10_000 });
      await stopBtn.click();
      await page.waitForTimeout(800);

      await goToMixes(page);
      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toHaveCount(0, { timeout: 5_000 });
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (d): Prep mix card shows correct "Pull For Prep" quantities.
   *
   * amountAlreadyMade = 0 → pull = component lbs.
   * Uses run-profile oz (2.0) not mix-card fallback oz (0.5).
   * expectedPullLbs = (2.0/16) × 800 = 100.00
   */
  test("prep mix card shows correct pull quantities when a run uses its ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-pull-${suffix}`;
    const mixName = `PullPrepMix ${suffix}`;
    const ingredient = `TestHerb_${suffix}`;

    const MIX_CARD_OZ = 0.5;
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const CASES_PER_LAYER = 0;
    const totalPizzasForSauce = CASES_NEEDED * PIZZAS_PER_CASE + CASES_PER_LAYER * PIZZAS_PER_CASE;
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzasForSauce; // 100.00

    const brand = `Brand_${suffix}`;
    const today = todayStr();

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: MIX_CARD_OZ,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase, casesPerLayer }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE, casesPerLayer: CASES_PER_LAYER },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(ingredient, { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2); // "100.00"
      const wrongFallbackStr = ((MIX_CARD_OZ / 16) * totalPizzasForSauce).toFixed(2); // "25.00"

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (e): Per-run breakdown is correct when two brands share an ingredient.
   *
   * amountAlreadyMade = 0 → pull = contrib1 + contrib2 = 137.50
   * Run1: (2.0/16)×800 = 100.00, Run2: (1.5/16)×400 = 37.50
   */
  test("prep mix card shows correct per-run breakdown when two brands share an ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-breakdown-${suffix}`;
    const mixName = `BreakdownPrepMix ${suffix}`;
    const ingredient = `SharedHerb_${suffix}`;

    const brand1 = `Alpha_${suffix}`;
    const OZ1 = 2.0;
    const CASES1 = 100;
    const PPC = 8;
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
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: 0.1,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand1, brand2, ingredient, oz1, oz2, cases1, cases2, ppc }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;

          day.runs[0].brand = brand1;
          const runId1 = day.runs[0].id;
          const existing1 = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId1)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId1), JSON.stringify({
            ...existing1, pep1Type: ingredient, pep1OzPerPizza: oz1,
            casesNeeded: cases1, pizzasPerCase: ppc, casesPerLayer: 0,
          }));

          const runId2 = `e2e-run2-${Math.random().toString(36).slice(2, 9)}`;
          day.runs.push({ id: runId2, brand: brand2 });
          localStorage.setItem(RUN_KEY(runId2), JSON.stringify({
            pep1Type: ingredient, pep1OzPerPizza: oz2,
            casesNeeded: cases2, pizzasPerCase: ppc, casesPerLayer: 0,
          }));
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
        },
        { brand1, brand2, ingredient, oz1: OZ1, oz2: OZ2, cases1: CASES1, cases2: CASES2, ppc: PPC },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      const breakdownBtn = todayCard.getByRole("button", { name: /show run breakdown \(2 runs\)/i });
      await expect(breakdownBtn).toBeVisible({ timeout: 5_000 });
      await breakdownBtn.click();

      await expect(
        todayCard.getByRole("button", { name: /hide run breakdown \(2 runs\)/i }),
      ).toBeVisible({ timeout: 3_000 });

      const contrib1Str = contrib1Lbs.toFixed(2); // "100.00"
      const brand1Row = todayCard.locator("div", { has: page.getByText(brand1, { exact: false }) }).last();
      expect(await brand1Row.innerText()).toContain(contrib1Str);

      const contrib2Str = contrib2Lbs.toFixed(2); // "37.50"
      const brand2Row = todayCard.locator("div", { has: page.getByText(brand2, { exact: false }) }).last();
      expect(await brand2Row.innerText()).toContain(contrib2Str);

      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      const pullStr = pullLbs.toFixed(2); // "137.50"
      const ingredientRow = todayCard.locator("div", { has: page.getByText(ingredient, { exact: true }) }).last();
      expect(await ingredientRow.innerText()).toContain(pullStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (f): Pull For Prep is reduced proportionally when some of the mix is
   * already made (amountAlreadyMade = 50, single run).
   *
   * componentLbs = (2.0/16)×800 = 100.00
   * totalLbs     = 100×1.15+20  = 135.00
   * remainingLbs = 135-50       =  85.00
   * pull         = 100×85/135   ≈  62.96
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

    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const AMOUNT_ALREADY_MADE = 50;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;           // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00
    const remainingLbs = totalLbs - AMOUNT_ALREADY_MADE;          //  85.00
    const expectedPullLbs = componentLbs * remainingLbs / totalLbs; // ≈62.96
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

      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(fullStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (g): Pull For Prep shows 0.00 lbs when the mix is fully covered
   * (amountAlreadyMade >= totalLbs). Card still renders so staff can confirm.
   *
   * remainingLbs = max(0, 135-200) = 0 → pull = 0.00
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
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();
      expect(rowText).toContain("0.00");
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (i): Badge updates live when the "Already made" input is edited.
   *
   * Mechanism: onBlur → saveMixes → onSaved → cycleCountQc.setQueryData →
   * buildMixPlan re-runs → Pull For Prep and badge update without page reload.
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

    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;                     // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00

    const EDIT_AMOUNT = 50;
    const remainingAfterEdit = totalLbs - EDIT_AMOUNT;                     //  85.00
    const remainingStr = remainingAfterEdit.toFixed(2);                    // "85.00"

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      // Step 1: badge absent before any edit (remainingLbs == totalLbs)
      await expect(todayCard.getByText(/need .+ lbs/, { exact: false })).toHaveCount(0, { timeout: 3_000 });

      // Step 2: type 50 and blur
      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill(String(EDIT_AMOUNT));
      await alreadyMadeInput.press("Tab");
      await page.waitForTimeout(1_500);

      // Step 3: badge shows "need 85.00 lbs"
      await expect(
        todayCard.getByText(`need ${remainingStr} lbs`, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // Step 4: clear back to 0
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill("0");
      await alreadyMadeInput.press("Tab");
      await page.waitForTimeout(1_500);

      // Step 5: badge disappears
      await expect(todayCard.getByText(/need .+ lbs/, { exact: false })).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (h): Pull For Prep is scaled proportionally when TWO runs share a prep
   * ingredient and amountAlreadyMade > 0.  — Task #764 target.
   *
   * This is the multi-run analogue of test (f). The PULL FOR PREP total on the
   * ingredient row is scaled by `remainingLbs / totalLbs`, while per-run
   * breakdown rows show each run's FULL unscaled lbs (contrib.totalLbs).
   *
   * Formula (lib/mixes/src/index.ts, computeEntryFromComponentLbs):
   *   contrib1Lbs   = (2.0/16) × 800  = 100.00
   *   contrib2Lbs   = (1.5/16) × 400  =  37.50
   *   componentLbs  = 137.50
   *   totalLbs      = 137.50 × 1.15 + 20  = 178.125
   *   remainingLbs  = 178.125 − 50        = 128.125
   *   pullLbs       = 137.50 × 128.125 / 178.125 ≈ 98.90
   *
   * Breakdown rows must show unscaled 100.00 and 37.50 (NOT the scaled pull).
   */
  test("Pull For Prep is scaled proportionally when two runs share a prep ingredient and some is already made", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-partial-multi-${suffix}`;
    const mixName = `PartialMultiPrepMix ${suffix}`;
    const ingredient = `SharedPartialHerb_${suffix}`;
    const today = todayStr();

    const brand1 = `Alpha_${suffix}`;
    const OZ1 = 2.0;
    const CASES1 = 100;
    const PPC = 8;

    const brand2 = `Beta_${suffix}`;
    const OZ2 = 1.5;
    const CASES2 = 50;

    const pizzas1 = CASES1 * PPC; // 800
    const pizzas2 = CASES2 * PPC; // 400

    const contrib1Lbs = (OZ1 / 16) * pizzas1; // 100.00
    const contrib2Lbs = (OZ2 / 16) * pizzas2; //  37.50
    const contrib1Str = contrib1Lbs.toFixed(2); // "100.00"
    const contrib2Str = contrib2Lbs.toFixed(2); //  "37.50"

    const componentLbs = contrib1Lbs + contrib2Lbs; // 137.50

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const AMOUNT_ALREADY_MADE = 50;
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 178.125
    const remainingLbs = totalLbs - AMOUNT_ALREADY_MADE;                   // 128.125

    const pullLbs = componentLbs * remainingLbs / totalLbs; // ≈ 98.90
    const pullStr = pullLbs.toFixed(2); // "98.90"
    const fullStr = componentLbs.toFixed(2); // "137.50"

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: OZ1,
        amountAlreadyMade: AMOUNT_ALREADY_MADE,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand1, brand2, ingredient, oz1, oz2, cases1, cases2, ppc }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;

          day.runs[0].brand = brand1;
          const runId1 = day.runs[0].id;
          const existing1 = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId1)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId1), JSON.stringify({
            ...existing1, pep1Type: ingredient, pep1OzPerPizza: oz1,
            casesNeeded: cases1, pizzasPerCase: ppc, casesPerLayer: 0,
          }));

          const runId2 = `e2e-partial-run2-${Math.random().toString(36).slice(2, 9)}`;
          day.runs.push({ id: runId2, brand: brand2 });
          localStorage.setItem(RUN_KEY(runId2), JSON.stringify({
            pep1Type: ingredient, pep1OzPerPizza: oz2,
            casesNeeded: cases2, pizzasPerCase: ppc, casesPerLayer: 0,
          }));
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
        },
        { brand1, brand2, ingredient, oz1: OZ1, oz2: OZ2, cases1: CASES1, cases2: CASES2, ppc: PPC },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      // ── 1. Ingredient row shows SCALED pull (98.90), not full (137.50) ────────
      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();
      expect(rowText).toContain(pullStr);
      expect(rowText).not.toContain(fullStr);

      // ── 2. Breakdown rows show UNSCALED lbs ────────────────────────────────
      const breakdownBtn = todayCard.getByRole("button", { name: /show run breakdown \(2 runs\)/i });
      await expect(breakdownBtn).toBeVisible({ timeout: 5_000 });
      await breakdownBtn.click();
      await expect(
        todayCard.getByRole("button", { name: /hide run breakdown \(2 runs\)/i }),
      ).toBeVisible({ timeout: 3_000 });

      const brand1Row = todayCard.locator("div", { has: page.getByText(brand1, { exact: false }) }).last();
      expect(await brand1Row.innerText()).toContain(contrib1Str); // "100.00" (unscaled)

      const brand2Row = todayCard.locator("div", { has: page.getByText(brand2, { exact: false }) }).last();
      expect(await brand2Row.innerText()).toContain(contrib2Str); // "37.50" (unscaled)
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (i): Prep mix card appears for a SCHEDULED (future-day) run that lists
   * its ingredient, and is absent when today is selected (no live run uses it).
   *
   * Mechanism:
   *   home.tsx (~14477–14489) reads scheduledDays from the API and, for each
   *   scheduled run, loads the saved profile via loadProfile(brand, flavor).
   *   valsToMixRun() then builds ingredientOzPerPizza from the profile's pep
   *   fields, and buildMixPlan matches prep-mix components against each run's
   *   `ingredients` list. If the profile is missing or ingredient names don't
   *   align, the card is silently absent.
   *
   *   This test exercises that path end-to-end:
   *     1. A prep mix is inserted with a unique ingredient name.
   *     2. A scheduled run for tomorrow is inserted directly into daily_sync
   *        (scope=live) so the startup fetch returns it in scheduledDays.
   *     3. A profile for the brand is injected into localStorage with
   *        pep1Type=ingredient so loadProfile() returns it to valsToMixRun.
   *     4. With make-day = today (default): no live run uses the ingredient →
   *        empty-state is shown.
   *     5. With make-day = tomorrow: the scheduled run matches → group card
   *        appears with "Ingredient Prep", mix name, "Pull For Prep", and the
   *        correct pull lbs derived from the profile oz, not the mix-card fallback.
   *     6. Switching back to today: empty-state is restored.
   *
   * Formula:
   *   expectedPullLbs = (RUN_OZ / 16) × (CASES_NEEDED × PIZZAS_PER_CASE)
   *                   = (2.0 / 16) × 800 = 100.00 lbs
   *   MIX_CARD_OZ (0.5) is the wrong fallback; if the code ignores
   *   ingredientOzPerPizza the result would be 25.00.
   */
  test("prep mix card appears for a scheduled future-day run that lists its ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `sched-future-${suffix}`;
    const mixName = `FuturePrepMix ${suffix}`;
    const ingredient = `FutureHerb_${suffix}`;
    const brand = `FutureBrand_${suffix}`;
    const flavor = "";

    // MIX_CARD_OZ is the fallback perPizza stored on the mix itself.
    // RUN_OZ is the profile-derived oz/pizza that buildMixPlan should prefer.
    // If the profile lookup is broken the displayed lbs will be 25.00, not 100.00.
    const MIX_CARD_OZ = 0.5;
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 100.00
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 25.00

    // Tomorrow in YYYY-MM-DD using the shared local-calendar helper — consistent
    // with todayStr() and the app's ?today= keying so both dates are in the same
    // time zone frame and the step-10 "switch back to today" assertion is correct.
    const tomorrowLocal = new Date();
    tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);
    const tomorrowStr = localDateStr(tomorrowLocal);

    const scheduledRunId = `sched-run-${suffix}`;

    // Snapshot the existing daily_sync row (if any) so we can restore it on
    // teardown instead of permanently deleting shared schedule data.
    let preExistingRow: { data: unknown; updated_at: Date } | null = null;

    try {
      // ── Step 1: Insert the prep mix ──────────────────────────────────────────
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: MIX_CARD_OZ,
      });

      // ── Step 2: Snapshot + upsert a scheduled run for tomorrow in daily_sync ──
      // The /sync/scheduled endpoint reads daily_sync WHERE date > today AND
      // scope = 'live'. Read the existing row first so teardown can restore it.
      const existingResult = await db.query<{ data: unknown; updated_at: Date }>(
        `SELECT data, updated_at FROM daily_sync WHERE date = $1 AND scope = 'live'`,
        [tomorrowStr],
      );
      preExistingRow = existingResult.rows.length > 0 ? existingResult.rows[0] : null;

      const scheduledData = {
        dayState: {
          runs: [{ id: scheduledRunId, brand, flavor }],
        },
        runValues: {
          [scheduledRunId]: { casesNeeded: CASES_NEEDED },
        },
      };
      await db.query(
        `INSERT INTO daily_sync (date, scope, data, updated_at)
         VALUES ($1, 'live', $2::jsonb, NOW())
         ON CONFLICT (date, scope) DO UPDATE
           SET data = $2::jsonb, updated_at = NOW()`,
        [tomorrowStr, JSON.stringify(scheduledData)],
      );

      // ── Step 3: Sign up and dismiss onboarding ───────────────────────────────
      // Sign up AFTER the DB row exists so the startup fetch (on app mount) picks
      // up the scheduled run and populates scheduledDays React state.
      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Brief pause for startup async effects (useMixes + scheduledDays fetch).
      await page.waitForTimeout(1_000);

      // ── Step 4: Inject the profile into localStorage ─────────────────────────
      // loadProfile(brand, flavor) reads from localStorage key
      // `run-calc-profile-${brand.toLowerCase()}__${flavor.toLowerCase()}`.
      // valsToMixRun maps pep1Type → ingredientOzPerPizza, so the ingredient must
      // appear in pep1Type with pep1OzPerPizza = RUN_OZ. pizzasPerCase comes from
      // the profile (not the scheduled run), so it must be set here too.
      await page.evaluate(
        ({ brand, flavor, ingredient, runOz, pizzasPerCase }) => {
          const profileKey = `run-calc-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
          const existing = (() => {
            try {
              return JSON.parse(localStorage.getItem(profileKey) ?? "{}");
            } catch {
              return {};
            }
          })();
          localStorage.setItem(
            profileKey,
            JSON.stringify({
              ...existing,
              pep1Type: ingredient,
              pep1OzPerPizza: runOz,
              pizzasPerCase,
            }),
          );
        },
        { brand, flavor, ingredient, runOz: RUN_OZ, pizzasPerCase: PIZZAS_PER_CASE },
      );

      // ── Step 5: Navigate to the Mixes tab ────────────────────────────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      // ── Step 6: Today (default make-day) shows empty-state ──────────────────
      // The only live run today is the blank seeded placeholder (no brand, no
      // ingredient list), so buildMixPlan returns [] → empty-state is shown.
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });

      // ── Step 7: Switch make-day to tomorrow ──────────────────────────────────
      const makeDayPicker = page.locator('[data-testid="mix-make-day"]');
      await makeDayPicker.fill(tomorrowStr);
      // Tab away to trigger onChange (the date input fires on blur/change).
      await makeDayPicker.press("Tab");
      await page.waitForTimeout(800);

      // ── Step 8: Verify the group card for tomorrow is present ────────────────
      const tomorrowCard = page.locator(`[data-testid="mix-plan-${tomorrowStr}"]`);
      await tomorrowCard.waitFor({ state: "visible", timeout: 8_000 });

      // "Ingredient Prep" section heading confirms buildMixPlan found a prep match.
      await expect(
        tomorrowCard.getByText("Ingredient Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // The mix name must appear inside the group card.
      await expect(
        tomorrowCard.getByText(mixName, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // "Pull For Prep" section heading confirms the pull-lbs breakdown is rendered.
      await expect(
        tomorrowCard.getByText("Pull For Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // The ingredient name must appear in the pull-for-prep section.
      await expect(
        tomorrowCard.getByText(ingredient, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ── Step 9: Verify the pull lbs use profile oz, not the mix-card fallback ─
      const ingredientRow = tomorrowCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      // Profile-derived lbs = (RUN_OZ / 16) × 800 = 100.00.
      expect(rowText).toContain(expectedPullLbs.toFixed(2));
      // If the code ignores ingredientOzPerPizza and falls back to MIX_CARD_OZ
      // the result would be 25.00 — asserting it is absent proves the profile path.
      expect(rowText).not.toContain(wrongFallbackLbs.toFixed(2));

      // ── Step 10: Switch back to today → empty-state is restored ─────────────
      await makeDayPicker.fill(todayStr());
      await makeDayPicker.press("Tab");
      await page.waitForTimeout(800);

      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      // Restore or remove the daily_sync row losslessly: if one existed before
      // the test, upsert it back; otherwise delete only the test-inserted row.
      if (preExistingRow !== null) {
        await db
          .query(
            `INSERT INTO daily_sync (date, scope, data, updated_at)
             VALUES ($1, 'live', $2::jsonb, $3)
             ON CONFLICT (date, scope) DO UPDATE
               SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
            [tomorrowStr, JSON.stringify(preExistingRow.data), preExistingRow.updated_at],
          )
          .catch((err: unknown) => {
            console.error("WARN: failed to restore daily_sync row:", err);
          });
      } else {
        await db
          .query(
            "DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'",
            [tomorrowStr],
          )
          .catch(() => {});
      }
      await db
        .query("DELETE FROM users WHERE username = $1", [username])
        .catch(() => {});
    }
  });

  /**
   * Test (g2): Prep mix card appears when a run profile uses a QUALIFIED
   * ingredient name (e.g. "Herb - Dried") whose base name matches the mix
   * component "Herb".
   *
   * ingredientMatches() treats two names as equivalent when the shorter is a
   * word-boundary prefix of the longer.
   */
  test("prep mix card appears when run uses a qualified ingredient name matching the mix component base name", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-prefix-${suffix}`;
    const mixName = `PrefixPrepMix ${suffix}`;

    const componentBase = `Herb_${suffix}`;
    const qualifiedIngredient = `${componentBase} - Dried`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 3.0;
    const CASES_NEEDED = 80;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 640
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 120.00

    const MIX_CARD_OZ = 0.1;
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 4.00

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: componentBase,
        perPizza: MIX_CARD_OZ,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, qualifiedIngredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: qualifiedIngredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, qualifiedIngredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(componentBase, { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(componentBase, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2);       // "120.00"
      const wrongFallbackStr = wrongFallbackLbs.toFixed(2); //   "4.00"

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (h2): Pull For Prep updates live when the already-made field is edited.
   *
   * Step A: amountAlreadyMade=0 → pull = full componentLbs (100.00)
   * Step B: type 50 → pull ≈ 62.96
   * Step C: type 200 (>= totalLbs 135) → pull = 0.00
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

    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;                         // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS;     // 135.00

    const fullPullStr = componentLbs.toFixed(2); // "100.00"

    const PARTIAL_ALREADY_MADE = 50;
    const remainingAfterPartial = totalLbs - PARTIAL_ALREADY_MADE;             //  85.00
    const partialPullLbs = componentLbs * remainingAfterPartial / totalLbs;    // ≈62.96
    const partialPullStr = partialPullLbs.toFixed(2);                          // "62.96"

    const FULL_COVERAGE = 200;

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      expect(await ingredientRow.innerText()).toContain(fullPullStr);

      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.fill(String(PARTIAL_ALREADY_MADE));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      const partialText = await ingredientRow.innerText();
      expect(partialText).toContain(partialPullStr);
      expect(partialText).not.toContain(fullPullStr);

      await alreadyMadeInput.fill(String(FULL_COVERAGE));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      expect(await ingredientRow.innerText()).toContain("0.00");
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (i2): "need X lbs" badge on a regular (non-prep) mix card reflects
   * the correct remaining amount when amountAlreadyMade < totalLbs.
   */
  test("need X lbs badge on regular mix card shows correct remaining amount", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `reg-need-${suffix}`;
    const mixName = `RegNeedMix ${suffix}`;
    const component = `RegComp_${suffix}`;
    const brand = `RegBrand_${suffix}`;
    const today = todayStr();

    const PER_PIZZA_OZ = 2.0;
    const BATCH_SIZE = 10;
    const AMOUNT_ALREADY_MADE = 20;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;

    const pizzas = CASES_NEEDED * PIZZAS_PER_CASE;            // 800
    const componentLbs = (PER_PIZZA_OZ * pizzas) / 16;        // 100.00
    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00
    const remainingLbs = totalLbs - AMOUNT_ALREADY_MADE;       // 115.00
    const pullLbs = componentLbs * remainingLbs / totalLbs;    // ≈85.19

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        brand,
        isPrep: false,
        component,
        perPizza: PER_PIZZA_OZ,
        batchSize: BATCH_SIZE,
        amountAlreadyMade: AMOUNT_ALREADY_MADE,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({ ...existing, casesNeeded, pizzasPerCase, casesPerLayer: 0 }));
        },
        { brand, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      const needStr = remainingLbs.toFixed(2); // "115.00"
      await expect(todayCard.getByText(`need ${needStr} lbs`, { exact: false })).toBeVisible({ timeout: 5_000 });

      await expect(todayCard.getByText("Pull For Mix", { exact: false })).toBeVisible({ timeout: 5_000 });

      const pullStr = pullLbs.toFixed(2); // "85.19"
      const componentRow = todayCard.locator("div", { has: page.getByText(component, { exact: true }) }).last();
      const componentRowText = await componentRow.innerText();
      expect(componentRowText).toContain(pullStr);
      expect(componentRowText).not.toContain(componentLbs.toFixed(2));
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (j2): "need 0.00 lbs" badge on a regular mix card when
   * amountAlreadyMade >= totalLbs (fully covered).
   */
  test("need 0.00 lbs badge appears on regular mix card when amountAlreadyMade >= totalLbs", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `reg-full-${suffix}`;
    const mixName = `RegFullMix ${suffix}`;
    const component = `RegFullComp_${suffix}`;
    const brand = `RegFullBrand_${suffix}`;
    const today = todayStr();

    const PER_PIZZA_OZ = 2.0;
    const BATCH_SIZE = 10;
    const AMOUNT_ALREADY_MADE = 200;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        brand,
        isPrep: false,
        component,
        perPizza: PER_PIZZA_OZ,
        batchSize: BATCH_SIZE,
        amountAlreadyMade: AMOUNT_ALREADY_MADE,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({ ...existing, casesNeeded, pizzasPerCase, casesPerLayer: 0 }));
        },
        { brand, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("need 0.00 lbs", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Mix", { exact: false })).toBeVisible({ timeout: 5_000 });

      const componentRow = todayCard.locator("div", { has: page.getByText(component, { exact: true }) }).last();
      expect(await componentRow.innerText()).toContain("0.00");
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (h3): Pull For Prep updates live when "already made" is edited and TWO
   * runs share the prep ingredient.
   *
   * This is the multi-run live-reactivity counterpart to test (h2).
   * After editing amountAlreadyMade the ingredient-row pull quantity must
   * recalculate immediately without a page reload, using the same proportional
   * formula as the static multi-run case (test h):
   *
   *   contrib1Lbs = (2.0/16) × 800  = 100.00
   *   contrib2Lbs = (1.5/16) × 400  =  37.50
   *   componentLbs                   = 137.50
   *   totalLbs    = 137.50×1.15 + 20 = 178.125
   *
   *   amountAlreadyMade = 0   → pull = componentLbs         = 137.50
   *   amountAlreadyMade = 50  → pull = 137.50×128.125/178.125 ≈  98.90
   *   amountAlreadyMade = 300 → pull = max(0,…)              =   0.00
   */
  test("Pull For Prep updates live when already-made is edited and two runs share the prep ingredient", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-live-multi-${suffix}`;
    const mixName = `LiveMultiPrepMix ${suffix}`;
    const ingredient = `LiveMultiHerb_${suffix}`;
    const today = todayStr();

    const brand1 = `AlphaLive_${suffix}`;
    const OZ1 = 2.0;
    const CASES1 = 100;
    const PPC = 8;

    const brand2 = `BetaLive_${suffix}`;
    const OZ2 = 1.5;
    const CASES2 = 50;

    const pizzas1 = CASES1 * PPC;  // 800
    const pizzas2 = CASES2 * PPC;  // 400

    const contrib1Lbs = (OZ1 / 16) * pizzas1;  // 100.00
    const contrib2Lbs = (OZ2 / 16) * pizzas2;  //  37.50
    const componentLbs = contrib1Lbs + contrib2Lbs; // 137.50

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 178.125

    const fullPullStr = componentLbs.toFixed(2); // "137.50"

    const PARTIAL_ALREADY_MADE = 50;
    const remainingAfterPartial = totalLbs - PARTIAL_ALREADY_MADE;         // 128.125
    const partialPullLbs = componentLbs * remainingAfterPartial / totalLbs; // ≈98.90
    const partialPullStr = partialPullLbs.toFixed(2);                       // "98.90"

    const FULL_COVERAGE = 300;

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: OZ1,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject two runs sharing the same ingredient via localStorage
      await page.evaluate(
        ({ brand1, brand2, ingredient, oz1, oz2, cases1, cases2, ppc }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;

          day.runs[0].brand = brand1;
          const runId1 = day.runs[0].id;
          const existing1 = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId1)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId1), JSON.stringify({
            ...existing1, pep1Type: ingredient, pep1OzPerPizza: oz1,
            casesNeeded: cases1, pizzasPerCase: ppc, casesPerLayer: 0,
          }));

          const runId2 = `e2e-livemulti-run2-${Math.random().toString(36).slice(2, 9)}`;
          day.runs.push({ id: runId2, brand: brand2 });
          localStorage.setItem(RUN_KEY(runId2), JSON.stringify({
            pep1Type: ingredient, pep1OzPerPizza: oz2,
            casesNeeded: cases2, pizzasPerCase: ppc, casesPerLayer: 0,
          }));
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
        },
        { brand1, brand2, ingredient, oz1: OZ1, oz2: OZ2, cases1: CASES1, cases2: CASES2, ppc: PPC },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();

      // Step A: amountAlreadyMade = 0 → pull = componentLbs (137.50)
      expect(await ingredientRow.innerText()).toContain(fullPullStr);

      // Step B: edit to 50 → pull ≈ 98.90
      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.fill(String(PARTIAL_ALREADY_MADE));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      const partialText = await ingredientRow.innerText();
      expect(partialText).toContain(partialPullStr);
      expect(partialText).not.toContain(fullPullStr);

      // Step C: edit to 300 (>= totalLbs 178.125) → pull = 0.00
      await alreadyMadeInput.fill(String(FULL_COVERAGE));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      expect(await ingredientRow.innerText()).toContain("0.00");
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (k): 'need X lbs' badge on a regular (non-prep, brand-scoped) mix card
   * updates immediately when the manager edits the "already made" field.
   *
   * Mechanism: onBlur → saveMixes → onSaved → cycleCountQc.setQueryData(["mixes"], saved)
   * → useMixes returns the updated list → buildMixPlan re-runs with the new
   * amountAlreadyMade → m.remainingLbs changes → badge re-renders without a reload.
   *
   * The badge (home.tsx ~14556) is:
   *   {m.remainingLbs < m.totalLbs && <span>need {fmtNum(m.remainingLbs, 2)} lbs</span>}
   *
   * So:
   *   amountAlreadyMade = 0          → remainingLbs = totalLbs → badge absent
   *   amountAlreadyMade = 50         → remainingLbs = 85.00   → badge "need 85.00 lbs"
   *   amountAlreadyMade >= totalLbs  → remainingLbs = 0       → badge "need 0.00 lbs"
   *
   * Math (same as test (i2)):
   *   componentLbs = (2.0/16) × 800        = 100.00
   *   totalLbs     = 100 × 1.15 + 20       = 135.00
   *   remainingLbs (partial) = 135 − 50    =  85.00
   */
  test("'need X lbs' badge on a regular mix card updates live when 'already made' is edited", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `reg-live-edit-${suffix}`;
    const mixName = `RegLiveEditMix ${suffix}`;
    const component = `RegLiveComp_${suffix}`;
    const brand = `RegLiveBrand_${suffix}`;
    const today = todayStr();

    const PER_PIZZA_OZ = 2.0;
    const BATCH_SIZE = 10;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800

    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (PER_PIZZA_OZ * totalPizzas) / 16;                    // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS;     // 135.00

    const PARTIAL_AMOUNT = 50;
    const remainingAfterPartial = totalLbs - PARTIAL_AMOUNT;                   //  85.00
    const partialBadgeStr = remainingAfterPartial.toFixed(2);                  // "85.00"

    const FULL_COVERAGE = 200; // > totalLbs → remainingLbs = 0

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        brand,
        isPrep: false,
        component,
        perPizza: PER_PIZZA_OZ,
        batchSize: BATCH_SIZE,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject brand + case count directly into localStorage so the mix plan
      // has a live run it can match on (same pattern used throughout this suite).
      await page.evaluate(
        ({ brand, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Mix", { exact: false })).toBeVisible({ timeout: 5_000 });

      // ── Step 1: badge is ABSENT initially (amountAlreadyMade = 0, remainingLbs = totalLbs) ──
      await expect(todayCard.getByText(/need .+ lbs/, { exact: false })).toHaveCount(0, { timeout: 3_000 });

      // ── Step 2: type partial amount (50) and blur → badge appears with remainingLbs ──
      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill(String(PARTIAL_AMOUNT));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      await expect(
        todayCard.getByText(`need ${partialBadgeStr} lbs`, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ── Step 3: type a value >= totalLbs (200) → badge shows "need 0.00 lbs" ──
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill(String(FULL_COVERAGE));
      await alreadyMadeInput.blur();
      await page.waitForTimeout(2_500);

      await expect(
        todayCard.getByText("need 0.00 lbs", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (l): Prep mix with daysEarly=1 appears on the run day AND one day
   * early, but is absent two days before (outside the window).
   *
   * Mechanism: buildMixPlan (~line 1033 in lib/mixes/src/index.ts) filters
   * prep mixes with `if (du > mix.daysEarly) continue`, where du = daysUntil(
   * runDate, makeDay). For a prep mix with daysEarly=1 and a run on day+2:
   *
   *   make-day = day+2 (run day)   → du = 0  ≤ 1  → card SHOWN
   *   make-day = day+1 (one early) → du = 1  ≤ 1  → card SHOWN
   *   make-day = today  (day+0)    → du = 2  > 1  → card ABSENT
   *
   * Setup mirrors the "scheduled future-day run" test: the run is inserted
   * directly into daily_sync so the startup fetch sees it, and a profile is
   * injected into localStorage so valsToMixRun() builds the ingredient list.
   */
  test("prep mix with daysEarly=1 appears on the run day and one day early but not two days before", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `days-early-prep-${suffix}`;
    const mixName = `DaysEarlyPrepMix ${suffix}`;
    const ingredient = `DaysEarlyHerb_${suffix}`;
    const brand = `DaysEarlyBrand_${suffix}`;
    const flavor = "";

    const DAYS_EARLY = 1;
    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;

    // The scheduled run is two days from today.
    const runDateLocal = new Date();
    runDateLocal.setDate(runDateLocal.getDate() + 2);
    const runDateStr = localDateStr(runDateLocal);

    // The "one day early" make-day is tomorrow.
    const oneDayEarlyLocal = new Date();
    oneDayEarlyLocal.setDate(oneDayEarlyLocal.getDate() + 1);
    const oneDayEarlyStr = localDateStr(oneDayEarlyLocal);

    const scheduledRunId = `sched-de-run-${suffix}`;

    // Snapshot existing daily_sync row for the run date so teardown can restore it.
    let preExistingRow: { data: unknown; updated_at: Date } | null = null;

    try {
      // ── Step 1: Insert the prep mix with daysEarly = 1 ──────────────────────
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: 0.5,
        daysEarly: DAYS_EARLY,
      });

      // ── Step 2: Snapshot + upsert scheduled run for day+2 ───────────────────
      const existingResult = await db.query<{ data: unknown; updated_at: Date }>(
        `SELECT data, updated_at FROM daily_sync WHERE date = $1 AND scope = 'live'`,
        [runDateStr],
      );
      preExistingRow = existingResult.rows.length > 0 ? existingResult.rows[0] : null;

      const scheduledData = {
        dayState: {
          runs: [{ id: scheduledRunId, brand, flavor }],
        },
        runValues: {
          [scheduledRunId]: { casesNeeded: CASES_NEEDED },
        },
      };
      await db.query(
        `INSERT INTO daily_sync (date, scope, data, updated_at)
         VALUES ($1, 'live', $2::jsonb, NOW())
         ON CONFLICT (date, scope) DO UPDATE
           SET data = $2::jsonb, updated_at = NOW()`,
        [runDateStr, JSON.stringify(scheduledData)],
      );

      // ── Step 3: Sign up and dismiss onboarding ───────────────────────────────
      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      // ── Step 4: Inject profile into localStorage ─────────────────────────────
      // loadProfile(brand, flavor) → valsToMixRun maps pep1Type → ingredient list.
      await page.evaluate(
        ({ brand, flavor, ingredient, runOz, pizzasPerCase }) => {
          const profileKey = `run-calc-profile-${brand.toLowerCase().trim()}__${flavor.toLowerCase().trim()}`;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(profileKey) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(profileKey, JSON.stringify({
            ...existing,
            pep1Type: ingredient,
            pep1OzPerPizza: runOz,
            pizzasPerCase,
          }));
        },
        { brand, flavor, ingredient, runOz: RUN_OZ, pizzasPerCase: PIZZAS_PER_CASE },
      );

      // ── Step 5: Navigate to Mixes tab ────────────────────────────────────────
      await goToMixes(page);
      await page.waitForTimeout(500);

      // ── Scenario A: make-day = today (day+0) → du=2 > daysEarly=1 → absent ──
      // Default make-day is today; no live run uses the ingredient → empty state.
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(mixName, { exact: false })).toHaveCount(0, { timeout: 3_000 });

      // ── Scenario B: make-day = day+1 (one day early) → du=1 ≤ 1 → shown ─────
      const makeDayPicker = page.locator('[data-testid="mix-make-day"]');
      await makeDayPicker.fill(oneDayEarlyStr);
      await makeDayPicker.press("Tab");
      await page.waitForTimeout(800);

      const oneDayEarlyCard = page.locator(`[data-testid="mix-plan-${runDateStr}"]`);
      await oneDayEarlyCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(
        oneDayEarlyCard.getByText("Ingredient Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        oneDayEarlyCard.getByText(mixName, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        oneDayEarlyCard.getByText("Pull For Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        oneDayEarlyCard.getByText(ingredient, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ── Scenario C: make-day = day+2 (run day) → du=0 ≤ 1 → shown ───────────
      await makeDayPicker.fill(runDateStr);
      await makeDayPicker.press("Tab");
      await page.waitForTimeout(800);

      const runDayCard = page.locator(`[data-testid="mix-plan-${runDateStr}"]`);
      await runDayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(
        runDayCard.getByText("Ingredient Prep", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        runDayCard.getByText(mixName, { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ── Scenario D: switch back to today → absent again ───────────────────────
      await makeDayPicker.fill(todayStr());
      await makeDayPicker.press("Tab");
      await page.waitForTimeout(800);

      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(mixName, { exact: false })).toHaveCount(0, { timeout: 3_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      if (preExistingRow !== null) {
        await db
          .query(
            `INSERT INTO daily_sync (date, scope, data, updated_at)
             VALUES ($1, 'live', $2::jsonb, $3)
             ON CONFLICT (date, scope) DO UPDATE
               SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
            [runDateStr, JSON.stringify(preExistingRow.data), preExistingRow.updated_at],
          )
          .catch((err: unknown) => {
            console.error("WARN: failed to restore daily_sync row:", err);
          });
      } else {
        await db
          .query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [runDateStr])
          .catch(() => {});
      }
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (j): Mix plan collapses to empty when ALL runs in a shift are ended.
   *
   * After both runs are stopped, liveRunsForMixes returns [] so buildMixPlan
   * returns [] — the plan collapses and the empty-state message appears.
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

      await signUpAndDismissOnboarding(page, username, "TestPass123!");
      await page.waitForTimeout(1_000);

      // Set brand on run 1
      await page.locator('[data-testid="tab-run"]').click();
      const brandInput = page.locator('input[placeholder="Brand…"]').first();
      await brandInput.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput.click();
      await brandInput.fill(brand1);
      await brandInput.press("Enter");
      await page.waitForTimeout(800);

      // Add run 2 and set brand2
      const newRunBtn = page.getByRole("button", { name: /new run/i });
      await newRunBtn.waitFor({ state: "visible", timeout: 8_000 });
      await newRunBtn.click();
      await page.waitForTimeout(800);

      const brandInput2 = page.locator('input[placeholder="Brand…"]').first();
      await brandInput2.waitFor({ state: "visible", timeout: 10_000 });
      await brandInput2.click();
      await brandInput2.fill(brand2);
      await brandInput2.press("Enter");
      await page.waitForTimeout(800);

      // Both cards visible
      await goToMixes(page);
      await page.waitForTimeout(500);
      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName1, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName2, { exact: false })).toBeVisible({ timeout: 5_000 });

      // Switch to run 1 via Prev, start + stop it
      await page.locator('[data-testid="tab-run"]').click();
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
      await page.waitForTimeout(800);

      // After stopping run 1: date-group card still present (run 2 active)
      await goToMixes(page);
      await page.waitForTimeout(500);
      await expect(page.locator(`[data-testid="mix-plan-${today}"]`)).toBeVisible({ timeout: 5_000 });

      // Switch to run 2 via Next, start + stop it
      await page.locator('[data-testid="tab-run"]').click();
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
      await page.waitForTimeout(800);

      // Both runs ended → plan must be empty
      await goToMixes(page);
      await page.waitForTimeout(500);

      await expect(
        page.locator(`[data-testid="mix-plan-${today}"]`),
      ).toHaveCount(0, { timeout: 5_000 });
      await expect(
        page.locator('[data-testid="mix-plan-empty"]'),
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(mixName1, { exact: false })).toHaveCount(0, { timeout: 3_000 });
      await expect(page.getByText(mixName2, { exact: false })).toHaveCount(0, { timeout: 3_000 });
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId1]).catch(() => {});
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId2]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (k): "Already made" value persists after a page reload.
   *
   * Verifies that the onBlur → POST /api/mixes path actually writes to the
   * server (not just the React Query cache), so a hard reload re-fetches the
   * updated value and the Pull For Prep lbs remain reduced accordingly.
   *
   * Formula (same as test f):
   *   componentLbs  = (2.0/16) × 800  = 100.00
   *   totalLbs      = 100.00 × 1.15 + 20 = 135.00
   *   remainingLbs  = 135.00 − 50        =  85.00
   *   pullLbs       = 100.00 × 85.00 / 135.00 ≈ 62.96
   */
  test("'already made' value persists after a page reload (saved to server)", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `persist-reload-${suffix}`;
    const mixName = `PersistReloadPrepMix ${suffix}`;
    const ingredient = `PersistHerb_${suffix}`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 2.0;
    const CASES_NEEDED = 100;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 800
    const MIX_WASTE_FACTOR = 0.15;
    const STARTUP_LBS = 20;
    const componentLbs = (RUN_OZ / 16) * totalPizzas;                     // 100.00
    const totalLbs = componentLbs * (1 + MIX_WASTE_FACTOR) + STARTUP_LBS; // 135.00

    const EDIT_AMOUNT = 50;
    const remainingAfterEdit = totalLbs - EDIT_AMOUNT;                     //  85.00
    const expectedPullLbs = componentLbs * remainingAfterEdit / totalLbs;  // ≈62.96
    const expectedPullStr = expectedPullLbs.toFixed(2);                    // "62.96"
    const fullPullStr = componentLbs.toFixed(2);                           // "100.00"

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: ingredient,
        perPizza: RUN_OZ,
        amountAlreadyMade: 0,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      // Inject run data into localStorage so the mix card appears
      await page.evaluate(
        ({ brand, ingredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: ingredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, ingredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      // Navigate to Mixes and find the mix card
      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      // Step 1: type 50 into "Already made" and blur to trigger POST /api/mixes
      const alreadyMadeInput = todayCard.locator('input[type="number"]').first();
      await alreadyMadeInput.waitFor({ state: "visible", timeout: 5_000 });
      await alreadyMadeInput.click();
      await alreadyMadeInput.fill(String(EDIT_AMOUNT));
      await alreadyMadeInput.press("Tab");

      // Wait for the save round-trip to complete before reloading
      await page.waitForTimeout(2_000);

      // Step 2: Hard-reload the page — flushes the React Query cache entirely
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      // Navigate back to Mixes
      await goToMixes(page);
      await page.waitForTimeout(500);

      const reloadedCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await reloadedCard.waitFor({ state: "visible", timeout: 8_000 });
      await expect(reloadedCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });

      // Step 3: "Already made" input must show the saved value (50)
      const savedInput = reloadedCard.locator('input[type="number"]').first();
      await savedInput.waitFor({ state: "visible", timeout: 5_000 });
      await expect(savedInput).toHaveValue(String(EDIT_AMOUNT), { timeout: 5_000 });

      // Step 4: Pull For Prep lbs must reflect the reduced amount (≈62.96), not the full 100.00
      await expect(reloadedCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      const ingredientRow = reloadedCard
        .locator("div", { has: page.getByText(ingredient, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();
      expect(rowText).toContain(expectedPullStr);
      expect(rowText).not.toContain(fullPullStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (k1): Prep mix card appears when the run ingredient uses the COMMA
   * separator variant ("Herb, Chopped") and the mix component is the base
   * name ("Herb").
   *
   * ingredientMatches() accepts ',' as a word-boundary separator (line 1009 of
   * lib/mixes/src/index.ts). A regression that drops ',' from the separator
   * set would silently suppress this card.
   */
  test("prep mix card appears when run ingredient uses comma-separator variant (e.g. 'Herb, Chopped')", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-comma-${suffix}`;
    const mixName = `CommaPrepMix ${suffix}`;

    const componentBase = `Herb_${suffix}`;
    const qualifiedIngredient = `${componentBase}, Chopped`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 3.0;
    const CASES_NEEDED = 80;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 640
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 120.00

    const MIX_CARD_OZ = 0.1;
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 4.00

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: componentBase,
        perPizza: MIX_CARD_OZ,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, qualifiedIngredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: qualifiedIngredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, qualifiedIngredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(componentBase, { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(componentBase, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2);       // "120.00"
      const wrongFallbackStr = wrongFallbackLbs.toFixed(2); //   "4.00"

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (k2): Prep mix card appears when the run ingredient uses the PAREN
   * separator variant ("Herb (Tidbits)") and the mix component is the base
   * name ("Herb").
   *
   * ingredientMatches() accepts '(' as a word-boundary separator (line 1009 of
   * lib/mixes/src/index.ts). A regression that drops '(' from the separator
   * set would silently suppress this card.
   */
  test("prep mix card appears when run ingredient uses paren-separator variant (e.g. 'Herb (Tidbits)')", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-paren-${suffix}`;
    const mixName = `ParenPrepMix ${suffix}`;

    const componentBase = `Herb_${suffix}`;
    const qualifiedIngredient = `${componentBase} (Tidbits)`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 3.0;
    const CASES_NEEDED = 80;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 640
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 120.00

    const MIX_CARD_OZ = 0.1;
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 4.00

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: componentBase,
        perPizza: MIX_CARD_OZ,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, qualifiedIngredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: qualifiedIngredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, qualifiedIngredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(componentBase, { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(componentBase, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2);       // "120.00"
      const wrongFallbackStr = wrongFallbackLbs.toFixed(2); //   "4.00"

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });

  /**
   * Test (k3): Prep mix card appears when the run ingredient uses the SLASH
   * separator variant ("Herb/Fresh") and the mix component is the base
   * name ("Herb").
   *
   * ingredientMatches() accepts '/' as a word-boundary separator (line 1009 of
   * lib/mixes/src/index.ts). A regression that drops '/' from the separator
   * set would silently suppress this card.
   */
  test("prep mix card appears when run ingredient uses slash-separator variant (e.g. 'Herb/Fresh')", async ({
    page,
  }) => {
    const suffix = uid();
    const username = `user_${suffix}`;
    const mixId = `prep-slash-${suffix}`;
    const mixName = `SlashPrepMix ${suffix}`;

    const componentBase = `Herb_${suffix}`;
    const qualifiedIngredient = `${componentBase}/Fresh`;
    const brand = `Brand_${suffix}`;
    const today = todayStr();

    const RUN_OZ = 3.0;
    const CASES_NEEDED = 80;
    const PIZZAS_PER_CASE = 8;
    const totalPizzas = CASES_NEEDED * PIZZAS_PER_CASE; // 640
    const expectedPullLbs = (RUN_OZ / 16) * totalPizzas; // 120.00

    const MIX_CARD_OZ = 0.1;
    const wrongFallbackLbs = (MIX_CARD_OZ / 16) * totalPizzas; // 4.00

    try {
      await dbCreateMix(db, {
        id: mixId,
        name: mixName,
        isPrep: true,
        component: componentBase,
        perPizza: MIX_CARD_OZ,
      });

      await signUpAndDismissOnboarding(page, username, "TestPass123!");

      await page.evaluate(
        ({ brand, qualifiedIngredient, runOz, casesNeeded, pizzasPerCase }) => {
          const DAY_KEY = "run-calc-day";
          const RUN_KEY = (id: string) => `run-calc-run-${id}`;
          const rawDay = localStorage.getItem(DAY_KEY);
          if (!rawDay) return;
          const day = JSON.parse(rawDay) as { runs?: Array<{ id: string; brand?: string }> };
          if (!day.runs || day.runs.length === 0) return;
          day.runs[0].brand = brand;
          localStorage.setItem(DAY_KEY, JSON.stringify(day));
          const runId = day.runs[0].id;
          const existing = (() => {
            try { return JSON.parse(localStorage.getItem(RUN_KEY(runId)) ?? "{}"); } catch { return {}; }
          })();
          localStorage.setItem(RUN_KEY(runId), JSON.stringify({
            ...existing, pep1Type: qualifiedIngredient, pep1OzPerPizza: runOz,
            casesNeeded, pizzasPerCase, casesPerLayer: 0,
          }));
        },
        { brand, qualifiedIngredient, runOz: RUN_OZ, casesNeeded: CASES_NEEDED, pizzasPerCase: PIZZAS_PER_CASE },
      );

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
      await page.getByRole("button", { name: /^get.?started$/i })
        .waitFor({ state: "visible", timeout: 5_000 }).then((b) => b.click()).catch(() => {});
      await page.waitForTimeout(1_000);

      await goToMixes(page);
      await page.waitForTimeout(500);

      const todayCard = page.locator(`[data-testid="mix-plan-${today}"]`);
      await todayCard.waitFor({ state: "visible", timeout: 8_000 });

      await expect(todayCard.getByText("Ingredient Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(mixName, { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText("Pull For Prep", { exact: false })).toBeVisible({ timeout: 5_000 });
      await expect(todayCard.getByText(componentBase, { exact: false })).toBeVisible({ timeout: 5_000 });

      const ingredientRow = todayCard
        .locator("div", { has: page.getByText(componentBase, { exact: true }) })
        .last();
      const rowText = await ingredientRow.innerText();

      const expectedStr = expectedPullLbs.toFixed(2);       // "120.00"
      const wrongFallbackStr = wrongFallbackLbs.toFixed(2); //   "4.00"

      expect(rowText).toContain(expectedStr);
      expect(rowText).not.toContain(wrongFallbackStr);
    } finally {
      await db.query("DELETE FROM mixes WHERE id = $1", [mixId]).catch(() => {});
      await db.query("DELETE FROM users WHERE username = $1", [username]).catch(() => {});
    }
  });
});
