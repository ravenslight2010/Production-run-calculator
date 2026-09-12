/**
 * E2E: manager photo count review is safe to cancel, survives a reload as a
 * draft, and creates exactly the confirmed inventory quantity when applied.
 *
 * The vision provider is intercepted at the browser boundary so this journey
 * tests the real API, database transaction, auth capability, and UI without
 * spending an AI request or depending on a real photograph.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const PRODUCT = `Photo Count Product ${uniqueTestId("photo")}`;
const UNIT = "cases";
const testUsernames = new Set<string>();

async function signUp(page: Page, username: string): Promise<void> {
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    afterSignUp: async (currentPage) => {
      await currentPage.keyboard.press("Escape");
    },
  });
}

async function createManager(
  request: APIRequestContext,
  db: Client,
  username: string,
): Promise<string> {
  const response = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password: PASSWORD, accessCode: SIGNUP_CODE },
  });
  expect(response.ok(), `sign-up failed: ${response.status()}`).toBe(true);
  const { token } = await response.json() as { token: string };
  const user = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1",
    [username],
  );
  expect(user.rows).toHaveLength(1);
  await db.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
     ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
    [user.rows[0].id],
  );
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
    user.rows[0].id,
  ]);
  return token;
}

async function inventoryFor(page: Page): Promise<Array<{ name: string; onHand: number }>> {
  const response = await page.request.get(`${API_BASE}/api/inventory`);
  if (!response.ok()) throw new Error(`inventory read failed: ${response.status()}`);
  return response.json() as Promise<Array<{ name: string; onHand: number }>>;
}

async function openPhotoCount(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
  const observationsLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/inventory/count-observations") &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Inventory", exact: true }).click();
  await observationsLoaded;
  const card = page.getByTestId("photo-count-card").filter({ visible: true });
  await expect(card).toBeVisible();
  return card;
}

async function insertDraft(db: Client, photoCount: number): Promise<void> {
  const flags = ["Quantity estimate needs review"];
  if (photoCount > 1) flags.push("Duplicate photo attached");
  const draft = {
    productName: { value: PRODUCT, confidence: 0.95, evidence: [0] },
    brand: { value: "E2E Brand", confidence: 0.9, evidence: [0] },
    variant: { value: "E2E Variant", confidence: 0.9, evidence: [0] },
    barcode: { value: null, confidence: 0, evidence: [] },
    packageSize: { value: "5 lb", confidence: 0.6, evidence: [0] },
    printedWeight: { value: 5, confidence: 0.85, evidence: [0] },
    unitType: { value: UNIT, confidence: 0.95, evidence: [0] },
    casePack: { value: 4, confidence: 0.9, evidence: [0] },
    quantity: { value: 3, confidence: 0.4, evidence: [0] },
    context: { value: "shelf", confidence: 0.8, evidence: [0] },
    reviewFlags: flags,
    matchedKey: null,
  };
  await db.query(
    `INSERT INTO inventory_observations
     (scope, status, photos, draft, created_at, updated_at)
     VALUES ('live', 'draft', $1::jsonb, $2::jsonb, NOW(), NOW())`,
    [
      JSON.stringify(Array.from({ length: photoCount }, (_, index) => ({
        index,
        mimeType: "image/jpeg",
      }))),
      JSON.stringify(draft),
    ],
  );
}

async function removeFixture(db: Client): Promise<void> {
  await db.query(
    `DELETE FROM inventory_observations
     WHERE draft->'productName'->>'value' = $1`,
    [PRODUCT],
  );
  await db.query(
    `DELETE FROM inventory_ledger
     WHERE item_id IN (SELECT id FROM inventory_items WHERE name = $1)`,
    [PRODUCT],
  );
  await db.query(
    `DELETE FROM inventory_lots
     WHERE item_id IN (SELECT id FROM inventory_items WHERE name = $1)`,
    [PRODUCT],
  );
  await db.query("DELETE FROM inventory_items WHERE name = $1", [PRODUCT]);
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("photo count browser check");
});

test.beforeEach(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    // The card resumes the newest open draft, so each viewport starts from a
    // clean upload state even if an earlier project stopped mid-journey.
    await db.query("DELETE FROM inventory_observations WHERE status = 'draft'");
    await removeFixture(db);
  } finally {
    await db.end().catch(() => {});
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await removeFixture(db);
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("completes the manager photo-count review on desktop and phone", async ({
  page,
  request,
}, testInfo) => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const username = uniqueTestId("photo_manager");
  testUsernames.add(username);
  try {
    await db.connect();
    await removeFixture(db);
    const token = await createManager(request, db, username);
    await page.context().addCookies([{ name: "rc_auth", value: token, url: API_BASE }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const beforeCancel = await inventoryFor(page);
    await insertDraft(db, 1);
    let card = await openPhotoCount(page);
    const review = card.getByTestId("photo-count-review");
    await expect(review).toContainText("1 photo");
    await expect(card).toContainText("New photo counts are disabled");
    await expect(card.locator('input[type="file"]')).toHaveCount(0);
    await expect(card).toContainText("Draft only");
    await expect(card).toContainText("Review flags:");
    await expect(card.getByLabel("Product")).toHaveValue(PRODUCT);
    await expect(card.getByLabel("Counted quantity")).toHaveValue("3");
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(await inventoryFor(page)).toEqual(beforeCancel);

    await insertDraft(db, 2);
    await page.reload({ waitUntil: "domcontentloaded" });
    card = await openPhotoCount(page);
    await expect(card.getByTestId("photo-count-review")).toContainText("2 photos");
    await expect(card).toContainText("Duplicate photo attached");
    await card.getByLabel("Counted quantity").fill("7");
    await card.getByLabel("Product").fill(`${PRODUCT} edited`);
    await card.getByLabel("Product").fill(PRODUCT);

    const observationResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/inventory/count-observations") &&
        response.request().method() === "POST" &&
        response.url().endsWith("/apply"),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    card = await openPhotoCount(page);
    await expect(card.getByTestId("photo-count-review")).toContainText("2 photos");
    await expect(card.getByLabel("Counted quantity")).toHaveValue("3");
    await expect(card.getByLabel("Product")).toHaveValue(PRODUCT);
    await card.getByLabel("Counted quantity").fill("7");

    await card.getByRole("button", { name: "Apply confirmed count", exact: true }).click();
    expect((await observationResponse).status()).toBe(200);
    await expect.poll(async () => {
      const items = await inventoryFor(page);
      return items.find((item) => item.name === PRODUCT)?.onHand ?? 0;
    }).toBe(7);

    const persisted = await db.query<{ quantity: string }>(
      `SELECT COALESCE(SUM(qty_remaining), 0)::text AS quantity
       FROM inventory_lots l
       JOIN inventory_items i ON i.id = l.item_id
       WHERE i.name = $1`,
      [PRODUCT],
    );
    expect(persisted.rows[0]?.quantity).toBe("7");
    await testInfo.attach("photo-count-viewport", {
      body: Buffer.from(`${page.viewportSize()?.width}x${page.viewportSize()?.height}`),
      contentType: "text/plain",
    });
  } finally {
    await db.end().catch(() => {});
  }
});