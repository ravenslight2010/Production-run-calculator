import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const API_BASE = requireLocalFixtureApiOrigin(
  "Premade crust profile browser fixture",
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
);
const recipeIds = new Set<string>();

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  const profilesLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/brand-profiles") &&
      response.request().method() === "GET" &&
      response.ok(),
  );
  await page.getByRole("button", { name: /^sign.?in$/i }).click();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await profilesLoaded;
}

async function writeDoughRecipe(
  page: Page,
  recipe: { id: string; name: string; isPremadeCrust: boolean },
): Promise<void> {
  const result = await page.evaluate(async (item) => {
    const current = await fetch("/api/dough-recipes", { cache: "no-store" });
    const epoch = current.headers.get("x-master-data-epoch");
    if (!current.ok || !epoch) return { status: current.status, hasEpoch: Boolean(epoch) };
    const snapshot = await current.json() as {
      items?: Array<{ id: string; name: string; updatedAt?: string }>;
    };
    const existing = snapshot.items?.find((candidate) => candidate.id === item.id);
    if (existing && existing.name !== item.name) {
      return { status: 409, hasEpoch: true, error: "fixture_id_collision" };
    }
    const response = await fetch("/api/dough-recipes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Data-Epoch": epoch,
      },
      body: JSON.stringify({
        items: [{
          ...item,
          ...(existing?.updatedAt ? { updatedAt: existing.updatedAt } : {}),
          notes: "",
          components: [{ ingredient: "Synthetic Dough Flour", lbs: 10 }],
          enabled: true,
          brand: "",
          flavors: [],
        }],
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    return {
      status: response.status,
      hasEpoch: true,
      error: typeof body.error === "string" ? body.error : null,
    };
  }, recipe);
  expect(result.hasEpoch, "dough recipe write uses the current master-data epoch").toBe(true);
  expect(result.status, `dough recipe fixture write (${result.error ?? "no error code"})`).toBe(200);
}

async function writeDoughProfile(
  account: Parameters<AuthorizedBrowserFixtures["seedBrandProfile"]>[0],
  brand: string,
  flavor: string,
  recipeName: string,
): Promise<void> {
  await fixtures.seedBrandProfile(account, {
    brand,
    flavor,
    values: {
      _subTab: "dough",
      dieType: "8-Cut",
      cycleSpeed: 10,
      doughRecipeName: recipeName,
      doughballsPerTray: 12,
      casesNeeded: 100,
      casesPerSkid: 3,
      pizzasPerCase: 12,
      crustsPerCycle: 4,
      freezerTime: 0.25,
    },
  });
}

async function ensureLineSetupOpen(page: Page): Promise<void> {
  const lineType = page.getByText("Line Type", { exact: true });
  if (!(await lineType.isVisible().catch(() => false))) {
    await page.locator("summary", { hasText: "Line Setup" }).click();
  }
  await lineType.waitFor({ state: "visible" });
}

async function selectBrandAndFlavor(
  page: Page,
  brand: string,
  flavor: string,
): Promise<void> {
  const brandInput = page.locator('input[placeholder="Brand…"]');
  await brandInput.click();
  if (await brandInput.isEditable()) {
    await brandInput.fill(brand);
    await brandInput.press("Enter");
  } else {
    await expect(brandInput).toHaveValue(brand);
  }

  const flavorInput = page.locator('input[placeholder="Flavor…"]');
  await flavorInput.click();
  if (await flavorInput.isEditable()) {
    await flavorInput.fill(flavor);
    await flavorInput.press("Enter");
  } else {
    await expect(flavorInput).toHaveValue(flavor);
  }
  await ensureLineSetupOpen(page);
}

let db: Client;
let fixtures: AuthorizedBrowserFixtures;
test.beforeAll(async ({ playwright }) => {
  db = new Client({
    connectionString: requireIsolatedTestDatabase("premade-crust profile browser test"),
  });
  await db.connect();
  fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
});

test.afterAll(async () => {
  if (!db) return;
  try {
    await fixtures?.cleanup();
    if (recipeIds.size > 0) {
      await db.query("DELETE FROM dough_recipes WHERE id = ANY($1::text[])", [[...recipeIds]]);
    }
  } finally {
    await db.end();
  }
});

test("marked profile selects Crust for a new run, not an already-started run", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const suffix = uid("premade_profile");
  const username = uid("premade_user");
  const brand = `Premade Profile ${suffix}`;
  const flavor = `Pepperoni ${suffix}`;
  const recipeId = `premade_recipe_${randomUUID()}`;
  const recipeName = `In-house Dough ${suffix}`;
  recipeIds.add(recipeId);

  const account = await fixtures.createAccount({
    username,
    password: PASSWORD,
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
    onboardingSeen: true,
  });
  const fixtureDate = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  // Establish our own empty canonical day before Home mounts. A preceding case
  // may have left an active run; its frozen setup is not this profile's defaults.
  // The fixture validates disposable DB ownership, binds the authenticated
  // account and takes the same live-scope lock as the other canonical fixtures.
  await fixtures.seedCanonicalTodaySnapshot({
    token: account.token,
    date: fixtureDate,
    payload: {
      dayState: {
        date: fixtureDate, runs: [], currentIndex: 0, resetAt: 0,
        substitutions: [], substitutionLog: [], stagedItems: {},
      },
      runValues: {},
      runValuesUpdatedAt: {},
      packagingProgress: {},
    },
  });
  await signIn(page, username);
  await writeDoughRecipe(page, { id: recipeId, name: recipeName, isPremadeCrust: false });
  await writeDoughProfile(account, brand, flavor, recipeName);

  // Reload so both the shared recipe and profile are adopted from the server.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await ensureLineSetupOpen(page);
  await selectBrandAndFlavor(page, brand, flavor);
  const doughButton = page.getByRole("button", { name: "Dough", exact: true });
  const crustButton = page.getByRole("button", { name: "Crust", exact: true });
  await expect(doughButton).toHaveClass(/bg-background/);
  await expect(page.getByTestId("button-start-run")).toBeEnabled();

  const startResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/sync/operational-intents" &&
    response.request().method() === "POST",
  );
  await page.getByTestId("button-start-run").click();
  const startResponse = await startResponsePromise;
  expect(startResponse.status(), "run start acknowledgement").toBe(200);
  const startAck = await startResponse.json() as {
    ok?: boolean;
    data?: { dayState?: { runs?: Array<{ id: string; startedAt?: number }> } };
  };
  expect(startAck.ok).toBe(true);
  const startedRun = startAck.data?.dayState?.runs?.find((run) => run.startedAt);
  expect(startedRun?.id, "the first run is canonically started").toBeTruthy();
  expect(startedRun?.startedAt).toEqual(expect.any(Number));
  await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeVisible();
  await expect(doughButton).toHaveClass(/bg-background/);
  await expect(crustButton).not.toHaveClass(/bg-background/);

  // A later manager classification must not rewrite a production run that has
  // already started. Re-entering the app also exercises persisted run mode.
  await writeDoughRecipe(page, { id: recipeId, name: recipeName, isPremadeCrust: true });
  // Hold canonical master data across the reload. Profile selection must wait
  // for the manager-controlled recipe marker instead of silently defaulting
  // the new run to Dough while startup data is unavailable.
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  let allowBootstrap = false;
  await page.route("**/api/master-data/bootstrap", async (route) => {
    if (!allowBootstrap) {
      await bootstrapGate;
      if (!allowBootstrap) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "synthetic_master_data_unavailable" }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect(page.getByRole("button", { name: "PAUSE RUN", exact: true })).toBeVisible();
  await ensureLineSetupOpen(page);
  await expect(doughButton).toHaveClass(/bg-background/);
  await expect(crustButton).not.toHaveClass(/bg-background/);

  await page.getByRole("button", { name: "New Run", exact: true }).click();
  await expect(page.getByText("Run 2 of 2", { exact: true })).toBeVisible();
  await selectBrandAndFlavor(page, brand, flavor);
  await expect(page.getByText("Checking shared recipe status", { exact: true })).toBeVisible();
  await expect(doughButton).toHaveClass(/bg-background/);
  await expect(crustButton).not.toHaveClass(/bg-background/);
  await expect(page.locator('input[placeholder="Flavor…"]')).toHaveValue("");

  // A failed canonical read must not apply a plausible but wrong profile.
  releaseBootstrap();
  await expect(page.getByText("Profile not applied", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(doughButton).toHaveClass(/bg-background/);
  await expect(crustButton).not.toHaveClass(/bg-background/);
  await expect(page.locator('input[placeholder="Flavor…"]')).toHaveValue("");

  // The explicit user retry fetches the canonical marker and applies the
  // linked profile; no blind replay or cached empty-recipe inference is used.
  allowBootstrap = true;
  const masterDataLoaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/master-data/bootstrap" &&
    response.request().method() === "GET" &&
    response.status() === 200,
  );
  await selectBrandAndFlavor(page, brand, flavor);
  const bootstrapResponse = await masterDataLoaded;
  const bootstrap = await bootstrapResponse.json() as {
    doughRecipes?: Array<{ id: string; isPremadeCrust?: boolean }>;
  };
  expect(bootstrap.doughRecipes).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: recipeId, isPremadeCrust: true })]),
  );
  await expect(crustButton).toHaveClass(/bg-background/);
  await expect(page.getByTestId("button-start-run")).toBeEnabled();

  const persistedModes = await page.evaluate(() => {
    const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}") as {
      runs?: Array<{ id: string; subTab?: string }>;
    };
    return day.runs?.map((run) => ({ id: run.id, subTab: run.subTab })) ?? [];
  });
  expect(persistedModes.find((run) => run.id === startedRun!.id)?.subTab).toBe("dough");
  expect(persistedModes.find((run) => run.id !== startedRun!.id)?.subTab).toBe("crusts");
});
