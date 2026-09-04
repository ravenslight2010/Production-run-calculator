/**
 * E2E: Run Insights card — accept / dismiss / follow-up flow
 *
 * Verifies the full browser journey that unit + integration tests cannot:
 *   suggestion appears → manager clicks Accept → cycleSpeed changes in the saved
 *   profile → confirmation line shows → Dismiss suppresses a second suggestion
 *   → follow-up note appears → "Got it" clears it.
 *
 * Strategy: inject suggestion candidates directly via POST /api/run-suggestions/observe
 * (the same payload the client posts after run finalization). The browser flow from
 * that point is identical to the real path.
 *
 * Profile-sync ordering is critical: loadProfile() reads from localStorage, which
 * is seeded by seedProfilesFromServer() at app startup. We therefore create the
 * server profile via API BEFORE opening the browser so the startup sync picks it up.
 *
 * Relevant files:
 *   artifacts/run-calculator/src/components/RunInsightsCard.tsx  (data-testids)
 *   artifacts/run-calculator/src/runInsights.ts                  (eval thresholds)
 *   artifacts/run-calculator/src/pages/home.tsx                  (applyRunSuggestion)
 *   artifacts/run-calculator/src/storage.ts                      (profileObjHasRealData guard)
 *   artifacts/api-server/src/routes/runSuggestions.ts
 *   lib/db/src/schema/runSuggestions.ts
 *
 * Run with:
 *   PLAYWRIGHT_BASE_URL=https://<dev-domain> \
 *   STAFF_SIGNUP_CODE=<code> \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *   DATABASE_URL=<connection-string> \
 *   pnpm --filter @workspace/run-calculator exec playwright test run-insights
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
} from "./isolation";

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2e_ri_${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * Browser sign-in form → wait for the main app to be ready.
 * Assumes onboarding_seen = true (no overlay to dismiss).
 */
async function signIn(
  page: Page,
  username: string,
  password: string,
  product: { brand: string; flavor: string },
): Promise<void> {
  // This fixture creates a synthetic server profile without mutating the shared
  // factory brand list. Skip the one-time legacy orphan-profile cleanup so it
  // does not delete that deliberately isolated record during startup.
  await page.addInitScript(({ brand, flavor, runId }) => {
    localStorage.setItem("run-calc-purge-orphaned-profiles-v1", "1");
    localStorage.setItem("run-calc-day", JSON.stringify({
      runs: [{ id: runId, brand, flavor, seeded: false }],
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
    localStorage.setItem(`run-calc-run-${runId}`, JSON.stringify({}));
  }, {
    brand: product.brand,
    flavor: product.flavor,
    runId: `run-insights-${username}`,
  });
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // Wait for the main app tabs to be ready
  await page.locator('[data-testid="tab-run"]').waitFor({ state: "attached", timeout: 25_000 });
  // Brief pause for startup async effects (seedProfilesFromServer, etc.)
  await page.waitForTimeout(1500);
}

/**
 * Create a saved brand profile on the server so applyRunSuggestion has
 * something to update via loadProfile() → saveProfile().
 *
 * IMPORTANT: `dieType` is required for profileObjHasRealData() to pass in
 * storage.ts. Without a qualifying field (dieType, appNType, frontlineRecipeName,
 * or a recipe array), saveProfile() returns false and Accept throws
 * "No saved setup found for this product".
 */
async function createProfile(
  fixtures: AuthorizedBrowserFixtures,
  token: string,
  brand: string,
  flavor: string,
  cycleSpeed: number,
): Promise<void> {
  await fixtures.seedBrandProfile({ token }, {
    brand,
    flavor,
    values: {
      dieType: "8-Cut", // qualifies the profile — see profileObjHasRealData()
      cycleSpeed,
      crustsPerCycle: 4,
      speedAdjustment: 1,
      freezerTime: 8,
      casesNeeded: 100,
      pizzasPerCase: 12,
    },
    crustValues: {},
    updatedAt: Date.now() - 2000,
  });
}

/** Inject a pending speed-target suggestion via the observe endpoint. */
async function observeSuggestion(
  request: APIRequestContext,
  token: string,
  brand: string,
  flavor: string,
  configuredSpeed: number,
  recommendedSpeed: number,
): Promise<void> {
  const resp = await request.post(`${API_BASE}/api/run-suggestions/observe`, {
    headers: { "Content-Type": "application/json", Cookie: `rc_auth=${token}` },
    data: {
      type: "speed-target",
      brand,
      flavor,
      dieType: "",
      observedValue: recommendedSpeed,
      configuredValue: configuredSpeed,
      recommendedValue: recommendedSpeed,
      unit: "cycles/min",
      runCount: 3,
      statsLine: `The last 3 ${brand} ${flavor} runs averaged above the configured speed target.`,
    },
  });
  expect(resp.ok(), `POST /api/run-suggestions/observe failed: ${resp.status()}`).toBe(true);
  const body = await resp.json() as { ok?: boolean };
  expect(body.ok).toBe(true);
}

/**
 * Navigate to the Setup tab via the header overflow menu.
 * Setup has no bottom-nav trigger — it lives in the hamburger "More" menu.
 */
async function goToSetup(page: Page): Promise<void> {
  const menuBtn = page.locator('button[title="More"]');
  await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
  await menuBtn.click();
  const setupItem = page.getByRole("menuitem", { name: /^setup$/i });
  await setupItem.waitFor({ state: "visible", timeout: 5_000 });
  await setupItem.click();
  await page.waitForTimeout(400);
}

// ── DB client lifecycle ───────────────────────────────────────────────────────

let db: Client;
let authorizedFixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    API_BASE,
    SIGNUP_CODE,
  );
  db = new Client({
    connectionString: requireIsolatedTestDatabase("run insights fixture setup"),
  });
  await db.connect();
});

test.afterAll(async () => {
  try {
    await authorizedFixtures?.cleanup({
      syncDates: [new Date().toISOString().slice(0, 10)],
    });
  } finally {
    await db?.end().catch(() => {});
  }
});

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("Run Insights — accept, dismiss, follow-up", () => {
  const FIXTURE_SUFFIX = uid();
  const ACCEPT_PRODUCT = {
    brand: `InsightBrandAccept_${FIXTURE_SUFFIX}`,
    flavor: `FlavorAccept_${FIXTURE_SUFFIX}`,
  };
  const DISMISS_PRODUCT = {
    brand: `InsightBrandDismiss_${FIXTURE_SUFFIX}`,
    flavor: `FlavorDismiss_${FIXTURE_SUFFIX}`,
  };
  const FOLLOW_UP_PRODUCT = {
    brand: `InsightBrandFollowUp_${FIXTURE_SUFFIX}`,
    flavor: `FlavorFollowUp_${FIXTURE_SUFFIX}`,
  };
  const CONFIGURED_SPEED = 10;
  const RECOMMENDED_SPEED = 12.5;

  let username: string;
  let token: string;

  test.beforeEach(async () => {
    // Suggestions are factory-wide, not user-scoped. A timed-out release run
    // can be terminated before afterEach cleanup, leaving a pending fixture
    // that would be rendered alongside this test's deliberately unique one.
    await db.query("DELETE FROM run_suggestions WHERE brand LIKE 'InsightBrand%_e2e_ri_%'");
    await db.query(
      "DELETE FROM brand_profiles WHERE brand LIKE 'InsightBrand%_e2e_ri_%' AND scope = 'live'",
    );
    await authorizedFixtures.removeBrandProfiles();
    await authorizedFixtures.removeTodaySync([
      new Date().toISOString().slice(0, 10),
    ]);
  });

  test.afterEach(async ({ page }) => {
    // Close the page before deleting shared fixtures. This aborts any
    // finalize-time observation still owned by the scenario instead of letting
    // it recreate a suggestion after cleanup.
    await page.close();
    await db.query("DELETE FROM run_suggestions WHERE brand LIKE 'InsightBrand%_e2e_ri_%'");
    await authorizedFixtures.removeBrandProfiles();
    await authorizedFixtures.removeTodaySync([
      new Date().toISOString().slice(0, 10),
    ]);
  });

  test("Accept changes cycleSpeed in the saved profile and shows confirmation", async ({
    page,
    request,
  }) => {
    username = uid();

    // Step 1: API sign-up + manager promotion BEFORE opening the browser,
    // so the profile exists when the app's startup sync (seedProfilesFromServer)
    // runs and populates localStorage.
    ({ token } = await authorizedFixtures.createAccount({
      username,
      password: "TestPass123!",
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    }));
    await createProfile(
      authorizedFixtures,
      token,
      ACCEPT_PRODUCT.brand,
      ACCEPT_PRODUCT.flavor,
      CONFIGURED_SPEED,
    );
    await observeSuggestion(
      request,
      token,
      ACCEPT_PRODUCT.brand,
      ACCEPT_PRODUCT.flavor,
      CONFIGURED_SPEED,
      RECOMMENDED_SPEED,
    );

    // Step 2: Browser sign-in — the startup sync reads the server profile into localStorage
    await signIn(page, username, "TestPass123!", ACCEPT_PRODUCT);

    // Step 3: Navigate to Setup tab and refresh the Insights card
    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();

    // Step 4: Verify the suggestion card is rendered
    const suggestionBlock = page.locator('[data-testid="suggestion-speed-target"]');
    await suggestionBlock.waitFor({ state: "visible", timeout: 10_000 });
    await expect(suggestionBlock).toContainText(ACCEPT_PRODUCT.brand);
    await expect(suggestionBlock).toContainText(ACCEPT_PRODUCT.flavor);
    await expect(suggestionBlock).toContainText(String(RECOMMENDED_SPEED));

    // Step 5: Accept the suggestion
    const acceptBtn = page.locator('[data-testid="button-run-insights-accept"]');
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Step 6: Confirmation banner must appear with the new cycle speed
    const confirmation = page.locator('[data-testid="text-run-insights-confirmation"]');
    await confirmation.waitFor({ state: "visible", timeout: 10_000 });
    await expect(confirmation).toContainText("Cycle speed");
    await expect(confirmation).toContainText(String(RECOMMENDED_SPEED));

    // The pending suggestion block must have disappeared
    await expect(suggestionBlock).toHaveCount(0);

    // Step 7: Verify the server-side profile was updated
    await expect
      .poll(
        async () => {
          const profilesResp = await request.get(`${API_BASE}/api/brand-profiles`, {
            headers: { Cookie: `rc_auth=${token}` },
          });
          if (!profilesResp.ok()) return null;
          const { items } = (await profilesResp.json()) as {
            items: Array<{
              key: string;
              crustValues: Record<string, unknown>;
            }>;
          };
          const key =
            `${ACCEPT_PRODUCT.brand.toLowerCase()}__${ACCEPT_PRODUCT.flavor.toLowerCase()}`;
          return items.find((p) => p.key === key)?.crustValues?.cycleSpeed;
        },
        {
          message: "profile cycleSpeed was not persisted to the recommended value",
          timeout: 10_000,
        },
      )
      .toBe(RECOMMENDED_SPEED);
  });

  test("Dismiss suppresses the suggestion and it stays suppressed on same drift", async ({
    page,
    request,
  }) => {
    username = uid();
    ({ token } = await authorizedFixtures.createAccount({
      username,
      password: "TestPass123!",
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    }));
    await createProfile(
      authorizedFixtures,
      token,
      DISMISS_PRODUCT.brand,
      DISMISS_PRODUCT.flavor,
      CONFIGURED_SPEED,
    );
    await observeSuggestion(
      request,
      token,
      DISMISS_PRODUCT.brand,
      DISMISS_PRODUCT.flavor,
      CONFIGURED_SPEED,
      RECOMMENDED_SPEED,
    );
    await signIn(page, username, "TestPass123!", DISMISS_PRODUCT);

    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();

    const suggestionBlock = page.locator('[data-testid="suggestion-speed-target"]');
    await suggestionBlock.waitFor({ state: "visible", timeout: 10_000 });
    await expect(suggestionBlock).toContainText(DISMISS_PRODUCT.brand);
    await expect(suggestionBlock).toContainText(DISMISS_PRODUCT.flavor);
    await expect(suggestionBlock).not.toContainText(ACCEPT_PRODUCT.flavor);

    // Dismiss the suggestion
    const dismissBtn = page.locator('[data-testid="button-run-insights-dismiss"]');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    // Pending suggestion block must disappear
    await expect(suggestionBlock).toHaveCount(0);
    // No confirmation banner for Dismiss
    await expect(page.locator('[data-testid="text-run-insights-confirmation"]')).toHaveCount(0);

    // Re-observe the SAME drift — observe endpoint should return suppressed:true
    const reResp = await request.post(`${API_BASE}/api/run-suggestions/observe`, {
      headers: { "Content-Type": "application/json", Cookie: `rc_auth=${token}` },
      data: {
        type: "speed-target",
        brand: DISMISS_PRODUCT.brand,
        flavor: DISMISS_PRODUCT.flavor,
        dieType: "",
        observedValue: RECOMMENDED_SPEED,
        configuredValue: CONFIGURED_SPEED,
        recommendedValue: RECOMMENDED_SPEED,
        unit: "cycles/min",
        runCount: 3,
        statsLine: "same drift re-observed",
      },
    });
    expect(reResp.ok()).toBe(true);
    const reBody = await reResp.json() as { ok: boolean; suppressed?: boolean };
    expect(reBody.ok).toBe(true);
    expect(
      reBody.suppressed,
      "dismissed suggestion must stay suppressed when re-observed with the same drift",
    ).toBe(true);
  });

  test("Follow-up note appears after next run and is cleared by Got-it", async ({
    page,
    request,
  }) => {
    username = uid();
    ({ token } = await authorizedFixtures.createAccount({
      username,
      password: "TestPass123!",
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
    }));
    await createProfile(
      authorizedFixtures,
      token,
      FOLLOW_UP_PRODUCT.brand,
      FOLLOW_UP_PRODUCT.flavor,
      CONFIGURED_SPEED,
    );
    await observeSuggestion(
      request,
      token,
      FOLLOW_UP_PRODUCT.brand,
      FOLLOW_UP_PRODUCT.flavor,
      CONFIGURED_SPEED,
      RECOMMENDED_SPEED,
    );
    await signIn(page, username, "TestPass123!", FOLLOW_UP_PRODUCT);

    // Accept the suggestion first so it moves to "accepted" status
    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();
    const suggestionBlock = page.locator('[data-testid="suggestion-speed-target"]');
    await suggestionBlock.waitFor({ state: "visible", timeout: 10_000 });
    await expect(suggestionBlock).toContainText(FOLLOW_UP_PRODUCT.brand);
    await expect(suggestionBlock).toContainText(FOLLOW_UP_PRODUCT.flavor);
    await expect(suggestionBlock).not.toContainText(ACCEPT_PRODUCT.flavor);
    await page.locator('[data-testid="button-run-insights-accept"]').click();
    await page
      .locator('[data-testid="text-run-insights-confirmation"]')
      .waitFor({ state: "visible", timeout: 10_000 });

    // Fetch the accepted suggestion ID
    const sugResp = await request.get(`${API_BASE}/api/run-suggestions`, {
      headers: { Cookie: `rc_auth=${token}` },
    });
    expect(sugResp.ok()).toBe(true);
    const { suggestions } = await sugResp.json() as {
      suggestions: Array<{ id: string; brand: string; flavor: string; status: string }>;
    };
    const accepted = suggestions.find(
      (s) =>
        s.brand === FOLLOW_UP_PRODUCT.brand &&
        s.flavor === FOLLOW_UP_PRODUCT.flavor &&
        s.status === "accepted",
    );
    expect(accepted, "accepted suggestion not found after Accept click").toBeTruthy();

    // Simulate the next run's finalize hook posting a follow-up note
    const fuResp = await request.post(`${API_BASE}/api/run-suggestions/follow-up`, {
      headers: { "Content-Type": "application/json", Cookie: `rc_auth=${token}` },
      data: {
        id: accepted!.id,
        note: "Speed target update seems accurate — last run came in within 2%.",
      },
    });
    expect(fuResp.ok()).toBe(true);

    // Refresh the card — the follow-up note must now be visible
    await refreshBtn.click();
    const followUpEl = page.locator('[data-testid="text-run-insights-followup-speed-target"]');
    await followUpEl.waitFor({ state: "visible", timeout: 10_000 });
    await expect(followUpEl).toContainText(FOLLOW_UP_PRODUCT.brand);
    await expect(followUpEl).toContainText(FOLLOW_UP_PRODUCT.flavor);
    await expect(followUpEl).toContainText("Speed target update seems accurate");

    // Click "Got it" — the note must disappear
    const gotItBtn = page.locator('[data-testid="button-run-insights-followup-clear"]');
    await expect(gotItBtn).toBeVisible();
    await gotItBtn.click();
    await expect(followUpEl).toHaveCount(0, { timeout: 5_000 });
  });
});
