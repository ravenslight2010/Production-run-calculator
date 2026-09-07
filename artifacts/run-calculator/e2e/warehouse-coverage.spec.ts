/**
 * E2E: the manager's real Inventory tab surfaces warehouse transfer coverage.
 *
 * The fixture is deliberately database-backed for inventory/catalog state and
 * local-storage-backed for the disposable run plan. This keeps the browser
 * journey on the same data paths used by production without relying on shared
 * factory data.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const testUsernames = new Set<string>();

const fixture = {
  ingredientId: uniqueTestId("warehouse_ingredient"),
  ingredientName: `Warehouse E2E Cheese ${uniqueTestId("name")}`,
  itemKey: "",
  itemName: "",
  locationName: `Warehouse E2E Overflow ${uniqueTestId("location")}`,
  itemId: 0,
  locationId: 0,
  onsiteId: 0,
};
fixture.itemKey = `ingredient:${fixture.ingredientName}:lbs`;
fixture.itemName = `Warehouse E2E Product ${uniqueTestId("product")}`;

async function createManager(
  request: APIRequestContext,
  db: Client,
  username: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password: PASSWORD, accessCode: SIGNUP_CODE },
  });
  expect(response.ok(), `sign-up failed: ${response.status()}`).toBe(true);

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
        "manage-profiles",
        "use-ai-tools",
      ]),
    ],
  );
  await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [
    user.rows[0].id,
  ]);
}

async function createStaff(
  request: APIRequestContext,
  db: Client,
  username: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/auth/sign-up`, {
    headers: { "Content-Type": "application/json" },
    data: { username, password: PASSWORD, accessCode: SIGNUP_CODE },
  });
  expect(response.ok(), `sign-up failed: ${response.status()}`).toBe(true);

  const user = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE username = $1",
    [username],
  );
  expect(user.rows).toHaveLength(1);
  await db.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'operator')
     ON CONFLICT (user_id) DO UPDATE SET role = 'operator'`,
    [user.rows[0].id],
  );
  await db.query("UPDATE users SET onboarding_seen = true WHERE id = $1", [
    user.rows[0].id,
  ]);
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function openInventory(page: Page, expectCoverage = true): Promise<void> {
  await page.locator('button[title="More"]').click();
  await page.getByRole("menuitem", { name: "Inventory", exact: true }).click();
  if (expectCoverage) {
    await expect(page.getByTestId("warehouse-coverage")).toBeVisible();
  }
}

async function seedRun(page: Page, runId: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveURL(/\/(?:#.*)?$/);
  await page.addInitScript(
    ({ id, ingredientName }) => {
      if (sessionStorage.getItem("warehouse-coverage-seed-applied") === "1") return;
      sessionStorage.setItem("warehouse-coverage-seed-applied", "1");
      const now = new Date();
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const values = {
        casesNeeded: 1,
        pizzasPerCase: 10,
        app1Type: ingredientName,
        app1OzPerPizza: 1,
      };
      localStorage.setItem(`run-calc-run-${id}`, JSON.stringify(values));
      localStorage.setItem(
        "run-calc-day",
        JSON.stringify({
          date,
          runs: [{ id, brand: "Warehouse E2E", flavor: "Coverage", casesNeeded: 1 }],
          runValues: { [id]: values },
          currentIndex: 0,
          resetAt: 0,
        }),
      );
    },
    { id: runId, ingredientName: fixture.ingredientName },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function seedInventory(db: Client): Promise<void> {
  const onsite = await db.query<{ id: number }>(
    "SELECT id FROM inventory_locations WHERE scope = 'live' AND is_onsite = true ORDER BY id LIMIT 1",
  );
  if (onsite.rows.length === 0) {
    const created = await db.query<{ id: number }>(
      `INSERT INTO inventory_locations (scope, name, is_onsite)
       VALUES ('live', 'Onsite (Line)', true) RETURNING id`,
    );
    fixture.onsiteId = created.rows[0].id;
  } else {
    fixture.onsiteId = onsite.rows[0].id;
  }

  const location = await db.query<{ id: number }>(
    `INSERT INTO inventory_locations (scope, name, is_onsite)
     VALUES ('live', $1, false) RETURNING id`,
    [fixture.locationName],
  );
  fixture.locationId = location.rows[0].id;

  const ingredient = await db.query(
    `INSERT INTO ingredients (id, scope, name, categories)
     VALUES ($1, 'live', $2, $3::jsonb)`,
    [fixture.ingredientId, fixture.ingredientName, JSON.stringify(["general"])],
  );
  expect(ingredient.rowCount).toBe(1);

  const item = await db.query<{ id: number }>(
    `INSERT INTO inventory_items
       (scope, key, category, name, unit, production_ingredient_id, conversion_factor)
     VALUES ('live', $1, 'ingredient', $2, 'lbs', $3, 10)
     RETURNING id`,
    [fixture.itemKey, fixture.itemName, fixture.ingredientId],
  );
  fixture.itemId = item.rows[0].id;

  // One unit offsite = 10 production lbs; demand is 10 lbs and onsite starts
  // empty, so the UI should cap the guidance at the exact shortfall.
  await db.query(
    `INSERT INTO inventory_lots
       (scope, item_id, location_id, qty_received, qty_remaining)
     VALUES
       ('live', $1, $2, 0.9, 0.9),
       ('live', $1, $3, 0, 0)`,
    [fixture.itemId, fixture.locationId, fixture.onsiteId],
  );
}

async function cleanupInventory(db: Client): Promise<void> {
  if (fixture.itemId) {
    await db.query("DELETE FROM inventory_items WHERE id = $1", [fixture.itemId]);
  }
  if (fixture.ingredientId) {
    await db.query(
      "DELETE FROM ingredients WHERE id = $1 AND scope = 'live'",
      [fixture.ingredientId],
    );
  }
  if (fixture.locationId) {
    await db.query("DELETE FROM inventory_locations WHERE id = $1", [fixture.locationId]);
  }
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("warehouse coverage browser check");
});


test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test.afterEach(async () => {
  if (!process.env.DATABASE_URL) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupInventory(db);
  } finally {
    await db.end().catch(() => {});
  }
});

test("shows capped offsite transfer guidance and hides it when onsite stock covers demand", async ({
  page,
  request,
}, testInfo) => {
  const username = uniqueTestId("warehouse_manager");
  const runId = uniqueTestId("warehouse_run");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await seedInventory(db);
    await createManager(request, db, username);
    await signIn(page, username);
    await seedRun(page, runId);
    await openInventory(page);

    const coverage = page.getByTestId("warehouse-coverage");
    const row = coverage
      .getByText(fixture.ingredientName, { exact: true })
      .locator("xpath=../..");
    await expect(row).toContainText("Short");
    await expect(row).toContainText(`Can cover 9 lbs from 9 lbs from ${fixture.locationName}.`);
    await page.screenshot({
      path: testInfo.outputPath("warehouse-coverage-offsite-guidance.png"),
      fullPage: true,
    });

    // Add enough stock through the authenticated restock API. This exercises
    // the same update/broadcast path the real Stock UI uses, so the mounted
    // Inventory tab recomputes without relying on an out-of-band DB mutation.
    const restock = await page.evaluate(
      async ({ itemKey, itemName, locationId }) => {
        const response = await fetch("/api/inventory/restock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemKey,
            category: "ingredient",
            name: itemName,
            unit: "lbs",
            qty: 2.1,
            locationId,
          }),
        });
        return response.status;
      },
      {
        itemKey: fixture.itemKey,
        itemName: fixture.itemName,
        locationId: fixture.onsiteId,
      },
    );
    expect(restock).toBe(200);
    await expect(row).toContainText("Covered");
    await expect(row).not.toContainText("Can cover");
    await page.screenshot({
      path: testInfo.outputPath("warehouse-coverage-onsite-covered.png"),
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
  } finally {
    await db.end().catch(() => {});
  }
});

test("explains restricted inventory actions to non-managers", async ({
  page,
  request,
}, testInfo) => {
  const username = uniqueTestId("warehouse_staff");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await seedInventory(db);
    await createStaff(request, db, username);
    await signIn(page, username);
    await openInventory(page, false);

    const itemName = page.getByText(fixture.itemName, { exact: true });
    await expect(itemName).toBeVisible();
    await itemName.click();

    const addStock = page.getByRole("button", { name: "Add stock", exact: true });
    await expect(addStock).toBeVisible();
    await page.getByPlaceholder("Qty", { exact: true }).fill("1");
    await expect(addStock).toBeEnabled();

    await expect(
      page.getByText(
        "Inventory Manager required to change stock records through manual adjustments. You can still review current inventory and record received stock.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Inventory Manager required to change stock records through transfers. You can still review current inventory and record received stock.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply adjustment", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Move stock", exact: true }),
    ).toBeDisabled();

    const capabilityStatuses = await page.evaluate(
      async ({ itemId, fromLocationId, toLocationId }) => {
        const [adjust, transfer] = await Promise.all([
          fetch("/api/inventory/adjust", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId, qtyDelta: 1, note: "staff denial check" }),
          }),
          fetch("/api/inventory/transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itemId,
              fromLocationId,
              toLocationId,
              qty: 0.1,
            }),
          }),
        ]);
        return { adjust: adjust.status, transfer: transfer.status };
      },
      {
        itemId: fixture.itemId,
        fromLocationId: fixture.locationId,
        toLocationId: fixture.onsiteId,
      },
    );
    expect(capabilityStatuses).toEqual({ adjust: 403, transfer: 403 });

    await page.screenshot({
      path: testInfo.outputPath("warehouse-staff-inventory-restrictions.png"),
      fullPage: true,
    });
    expect(browserErrors).toEqual([]);
  } finally {
    await db.end().catch(() => {});
  }
});

test("keeps capped offsite transfer guidance readable on a phone", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const username = uniqueTestId("warehouse_phone_manager");
  const runId = uniqueTestId("warehouse_phone_run");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await seedInventory(db);
    await createManager(request, db, username);
    await signIn(page, username);
    await seedRun(page, runId);
    await openInventory(page);

    const coverage = page.getByTestId("warehouse-coverage");
    const row = coverage
      .getByText(fixture.ingredientName, { exact: true })
      .locator("xpath=../..");
    const guidance = row.getByText(
      `Can cover 9 lbs from 9 lbs from ${fixture.locationName}.`,
      { exact: true },
    );

    await expect(row).toContainText("Short");
    await expect(guidance).toBeVisible();
    await expect(guidance).toHaveText(
      `Can cover 9 lbs from 9 lbs from ${fixture.locationName}.`,
    );

    const layout = await guidance.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      right: element.getBoundingClientRect().right,
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.scrollHeight).toBe(layout.clientHeight);
    expect(layout.right).toBeLessThanOrEqual(390);
    expect(browserErrors).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath("warehouse-coverage-phone-guidance.png"),
      fullPage: true,
    });
  } finally {
    await db.end().catch(() => {});
  }
});

test("keeps capped offsite transfer guidance readable on a tablet", async ({
  page,
  request,
}, testInfo) => {
  const viewport = { width: 768, height: 1024 };
  await page.setViewportSize(viewport);

  const username = uniqueTestId("warehouse_tablet_manager");
  const runId = uniqueTestId("warehouse_tablet_run");
  testUsernames.add(username);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await seedInventory(db);
    await createManager(request, db, username);
    await signIn(page, username);
    await seedRun(page, runId);
    await openInventory(page);

    const coverage = page.getByTestId("warehouse-coverage");
    const row = coverage
      .getByText(fixture.ingredientName, { exact: true })
      .locator("xpath=../..");
    const guidanceText = `Can cover 9 lbs from 9 lbs from ${fixture.locationName}.`;
    const guidance = row.getByText(guidanceText, { exact: true });

    await expect(row).toContainText("Short");
    await expect(guidance).toBeVisible();
    await expect(guidance).toHaveText(guidanceText);

    const layout = await guidance.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      right: element.getBoundingClientRect().right,
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.scrollHeight).toBe(layout.clientHeight);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);
    expect(browserErrors).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath("warehouse-coverage-tablet-guidance.png"),
      fullPage: true,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("warehouse-coverage")).toBeVisible();

    const reloadedCoverage = page.getByTestId("warehouse-coverage");
    const reloadedRow = reloadedCoverage
      .getByText(fixture.ingredientName, { exact: true })
      .locator("xpath=../..");
    const reloadedGuidance = reloadedRow.getByText(guidanceText, { exact: true });

    await expect(reloadedRow).toContainText("Short");
    await expect(reloadedGuidance).toBeVisible();
    await expect(reloadedGuidance).toHaveText(guidanceText);

    const reloadedLayout = await reloadedGuidance.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      right: element.getBoundingClientRect().right,
    }));
    expect(reloadedLayout.scrollWidth).toBe(reloadedLayout.clientWidth);
    expect(reloadedLayout.scrollHeight).toBe(reloadedLayout.clientHeight);
    expect(reloadedLayout.right).toBeLessThanOrEqual(viewport.width);
    expect(browserErrors).toEqual([]);
  } finally {
    await db.end().catch(() => {});
  }
});