/**
 * E2E: a receiving tablet keeps a server-sourced Dough/Crust preference
 * through a reload before a new run starts.
 *
 * The profile is written through the real brand-profiles API before the
 * browser opens. App startup therefore exercises profile reconciliation and
 * seeds the local profile cache from the server, while the reload verifies the
 * receiving-device path rather than an in-memory React state path.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";

function uid(): string {
  return `e2e_subtab_${Math.random().toString(36).slice(2, 10)}`;
}

const BRAND = "TabletCrustBrand";
const FLAVOR = "TabletCrustFlavor";
const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;

async function apiSignUp(
  request: APIRequestContext,
  db: Client,
  username: string,
): Promise<string> {
  const response = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password: PASSWORD, accessCode: SIGNUP_CODE },
  });
  expect(response.ok(), `sign-up failed: ${response.status()}`).toBe(true);
  const body = (await response.json()) as { token: string };
  const userResult = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1",
    [username],
  );
  const userId = userResult.rows[0]?.id;
  expect(userId, "sign-up did not create a database user").toBeTruthy();

  // The line-type controls are supervisor-gated. A manager account also avoids
  // profile writes being blocked if the app saves the pending run while the
  // brand and flavor are selected.
  await db.query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager') " +
      "ON CONFLICT (user_id) DO UPDATE SET role = 'manager'",
    [userId],
  );
  // Keep the E2E fixture independent of a database that predates the
  // manager-capability seed update.
  await db.query(
    "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
    [
      JSON.stringify([
        "manage-staff",
        "manage-inventory",
        "edit-production-rules",
        "approve-password-resets",
        "review-incidents",
        "use-ai-tools",
        "manage-factory-settings",
        "manage-profiles",
      ]),
    ],
  );
  await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [
    userId,
  ]);
  return body.token;
}

async function createCrustProfile(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/brand-profiles`, {
    headers: {
      "Content-Type": "application/json",
      Cookie: `rc_auth=${token}`,
    },
    data: {
      items: [
        {
          key: `${BRAND.toLowerCase()}__${FLAVOR.toLowerCase()}`,
          brand: BRAND,
          flavor: FLAVOR,
          values: {
            _subTab: "crusts",
            dieType: "8-Cut",
            cycleSpeed: 10,
            crustsPerCycle: 4,
            casesNeeded: 100,
            pizzasPerCase: 12,
          },
          crustValues: {},
          updatedAt: Date.now(),
        },
      ],
    },
  });
  expect(response.ok(), `profile save failed: ${response.status()}`).toBe(true);
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign.?in$/i }).click();
  await page
    .locator('[data-testid="tab-run"]')
    .waitFor({ state: "attached", timeout: 25_000 });
  await page.waitForTimeout(750);
}

async function unlockSupervisorLineSetup(page: Page): Promise<void> {
  await page.locator("summary", { hasText: "Line Setup" }).click();
  await page.getByText("Line Type", { exact: true }).waitFor({ state: "visible" });
}

async function selectBrandAndFlavor(page: Page): Promise<void> {
  const brandInput = page.locator('input[placeholder="Brand…"]');
  await brandInput.click();
  if (await brandInput.isEditable()) {
    await brandInput.fill(BRAND);
    await brandInput.press("Enter");
  } else {
    await expect(brandInput).toHaveValue(BRAND);
  }

  const flavorInput = page.locator('input[placeholder="Flavor…"]');
  await flavorInput.click();
  if (await flavorInput.isEditable()) {
    await flavorInput.fill(FLAVOR);
    await flavorInput.press("Enter");
  } else {
    await expect(flavorInput).toHaveValue(FLAVOR);
  }
}

let db: Client;
let username: string;
const testUsernames = new Set<string>();

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

test.afterAll(async () => {
  await db.query("DELETE FROM brand_profiles WHERE brand = $1", [BRAND]);
  for (const testUsername of testUsernames) {
    await db.query("DELETE FROM users WHERE username = $1", [testUsername]);
  }
  await db.end();
});

test("adopts crust preference, reloads, and starts a new run in crust mode", async ({
  page,
  request,
}) => {
  username = uid();
  testUsernames.add(username);
  const token = await apiSignUp(request, db, username);
  await createCrustProfile(request, token);
  await signIn(page, username);

  const profileSubtabKey = `${BRAND.toLowerCase()}__${FLAVOR.toLowerCase()}:subtab`;
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), profileSubtabKey), {
      timeout: 15_000,
    })
    .toBe("crusts");

  // A hard reload is the receiving-tablet boundary under test.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="tab-run"]').waitFor({
    state: "attached",
    timeout: 25_000,
  });
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), profileSubtabKey), {
      timeout: 10_000,
    })
    .toBe("crusts");

  await unlockSupervisorLineSetup(page);

  await selectBrandAndFlavor(page);

  // Selecting the identity creates/updates the pending run from the saved
  // profile preference. Assert the rendered line type before production starts.
  const crustsButton = page.getByRole("button", { name: "Crust", exact: true });
  await expect(crustsButton).toHaveClass(/bg-background/);
  await expect(
    page.getByText("Approximate Line Speed (ppm)", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid="button-start-run"]')).toBeVisible();
});

test("keeps the saved crust preference after sign-out and a fresh browser session", async ({
  browser,
  page,
  request,
}) => {
  username = uid();
  testUsernames.add(username);
  const token = await apiSignUp(request, db, username);
  await createCrustProfile(request, token);
  await signIn(page, username);

  await unlockSupervisorLineSetup(page);
  await selectBrandAndFlavor(page);

  await expect(page.getByRole("button", { name: "Crust", exact: true })).toHaveClass(
    /bg-background/,
  );

  // Exercise the same boundary as a tablet operator signing out, rather than
  // only clearing React state or reloading the existing browser context.
  await page.locator('button[title="More"], button[title*="manager action"]').first().click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/sign-out") &&
        response.request().method() === "POST",
    ),
    page.getByText("Sign out", { exact: true }).click(),
  ]);

  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  try {
    await signIn(freshPage, username);
    await unlockSupervisorLineSetup(freshPage);
    await selectBrandAndFlavor(freshPage);

    // The pending run must adopt the server profile before production begins.
    await expect(
      freshPage.getByRole("button", { name: "Crust", exact: true }),
    ).toHaveClass(/bg-background/);
    await expect(
      freshPage.getByText("Approximate Line Speed (ppm)", { exact: true }),
    ).toBeVisible();
    await expect(
      freshPage.locator('[data-testid="button-start-run"]'),
    ).toBeVisible();
  } finally {
    await freshContext.close();
  }
});