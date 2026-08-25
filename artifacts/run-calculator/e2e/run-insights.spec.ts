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

// ── helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e2e_ri_${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

/**
 * API sign-up (no browser) → promote to manager in DB.
 * Returns { token, userId } so the caller can use the token for
 * subsequent API calls BEFORE opening the browser, ensuring the
 * brand profile exists on the server before the app's startup sync runs.
 */
async function apiSignUp(
  request: APIRequestContext,
  db: Client,
  username: string,
  password: string,
): Promise<{ token: string; userId: string }> {
  const resp = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password, accessCode: SIGNUP_CODE },
  });
  expect(resp.ok(), `sign-up failed: ${resp.status()}`).toBe(true);
  const body = await resp.json() as { token: string; user: { userId: string } };
  const { token, user: { userId } } = body;

  // Promote to manager so Accept (requires use-ai-tools capability) works
  await db.query(
    "UPDATE user_roles SET role = 'manager' WHERE user_id = $1",
    [userId],
  );
  // Skip the "Get Started" onboarding overlay that auto-opens on first login
  await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [userId]);

  return { token, userId };
}

/**
 * Browser sign-in form → wait for the main app to be ready.
 * Assumes onboarding_seen = true (no overlay to dismiss).
 */
async function signIn(page: Page, username: string, password: string): Promise<void> {
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
  request: APIRequestContext,
  token: string,
  brand: string,
  flavor: string,
  cycleSpeed: number,
): Promise<void> {
  const key = `${brand.toLowerCase()}__${flavor.toLowerCase()}`;
  const resp = await request.post(`${API_BASE}/api/brand-profiles`, {
    headers: { "Content-Type": "application/json", Cookie: `rc_auth=${token}` },
    data: {
      items: [
        {
          key,
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
        },
      ],
    },
  });
  expect(resp.ok(), `POST /api/brand-profiles failed: ${resp.status()}`).toBe(true);
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

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

test.afterAll(async () => {
  await db.end();
});

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("Run Insights — accept, dismiss, follow-up", () => {
  const FIXTURE_SUFFIX = uid();
  const BRAND = `InsightBrand_${FIXTURE_SUFFIX}`;
  const FLAVOR_A = `FlavorAccept_${FIXTURE_SUFFIX}`;
  const FLAVOR_B = `FlavorDismiss_${FIXTURE_SUFFIX}`;
  const CONFIGURED_SPEED = 10;
  const RECOMMENDED_SPEED = 12.5;

  let username: string;
  let token: string;

  test.afterEach(async () => {
    // Clean up test suggestions, brand profiles, and user (user_roles cascades)
    await db.query("DELETE FROM run_suggestions WHERE brand = $1", [BRAND]);
    await db.query("DELETE FROM brand_profiles WHERE brand = $1", [BRAND]);
    await db.query("DELETE FROM users WHERE username = $1", [username]);
  });

  test("Accept changes cycleSpeed in the saved profile and shows confirmation", async ({
    page,
    request,
  }) => {
    username = uid();

    // Step 1: API sign-up + manager promotion BEFORE opening the browser,
    // so the profile exists when the app's startup sync (seedProfilesFromServer)
    // runs and populates localStorage.
    ({ token } = await apiSignUp(request, db, username, "TestPass123!"));
    await createProfile(request, token, BRAND, FLAVOR_A, CONFIGURED_SPEED);
    await observeSuggestion(request, token, BRAND, FLAVOR_A, CONFIGURED_SPEED, RECOMMENDED_SPEED);

    // Step 2: Browser sign-in — the startup sync reads the server profile into localStorage
    await signIn(page, username, "TestPass123!");

    // Step 3: Navigate to Setup tab and refresh the Insights card
    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();

    // Step 4: Verify the suggestion card is rendered
    const suggestionBlock = page.locator('[data-testid="suggestion-speed-target"]');
    await suggestionBlock.waitFor({ state: "visible", timeout: 10_000 });
    await expect(suggestionBlock).toContainText(BRAND);
    await expect(suggestionBlock).toContainText(FLAVOR_A);
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
            items: Array<{ brand: string; flavor: string; values: Record<string, unknown> }>;
          };
          return items.find((p) => p.brand === BRAND && p.flavor === FLAVOR_A)?.values?.cycleSpeed;
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
    ({ token } = await apiSignUp(request, db, username, "TestPass123!"));
    await createProfile(request, token, BRAND, FLAVOR_B, CONFIGURED_SPEED);
    await observeSuggestion(request, token, BRAND, FLAVOR_B, CONFIGURED_SPEED, RECOMMENDED_SPEED);
    await signIn(page, username, "TestPass123!");

    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();

    const suggestionBlock = page.locator('[data-testid="suggestion-speed-target"]');
    await suggestionBlock.waitFor({ state: "visible", timeout: 10_000 });
    await expect(suggestionBlock).toContainText(BRAND);

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
        brand: BRAND,
        flavor: FLAVOR_B,
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
    ({ token } = await apiSignUp(request, db, username, "TestPass123!"));
    await createProfile(request, token, BRAND, FLAVOR_A, CONFIGURED_SPEED);
    await observeSuggestion(request, token, BRAND, FLAVOR_A, CONFIGURED_SPEED, RECOMMENDED_SPEED);
    await signIn(page, username, "TestPass123!");

    // Accept the suggestion first so it moves to "accepted" status
    await goToSetup(page);
    const refreshBtn = page.locator('[data-testid="button-run-insights-refresh"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10_000 });
    await refreshBtn.click();
    await page
      .locator('[data-testid="suggestion-speed-target"]')
      .waitFor({ state: "visible", timeout: 10_000 });
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
      (s) => s.brand === BRAND && s.flavor === FLAVOR_A && s.status === "accepted",
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
    await expect(followUpEl).toContainText("Speed target update seems accurate");

    // Click "Got it" — the note must disappear
    const gotItBtn = page.locator('[data-testid="button-run-insights-followup-clear"]');
    await expect(gotItBtn).toBeVisible();
    await gotItBtn.click();
    await expect(followUpEl).toHaveCount(0, { timeout: 5_000 });
  });
});
