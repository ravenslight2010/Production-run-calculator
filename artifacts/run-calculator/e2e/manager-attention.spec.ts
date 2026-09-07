import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  uniqueTestId,
} from "./isolation";

const API_BASE =
  process.env.PLAYWRIGHT_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";

async function openManagerAttention(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Manager attention", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeVisible();
}

test("manager attention remains stable across dialog and destination transitions", async ({
  page,
  playwright,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  try {
    const account = await fixtures.createAccount({
      username: uniqueTestId("e2e_manager_attention"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    const scheduledBrand = uniqueTestId("AttentionBrand");
    const scheduledFlavor = uniqueTestId("AttentionFlavor");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.route("**/api/password-reset-requests", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: uniqueTestId("reset"),
          userId: uniqueTestId("staff"),
          username: "fixture-staff",
          requestedAt: new Date().toISOString(),
        }]),
      });
    });
    await page.route("**/api/incidents/actionable-count", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 1 }),
      }));
    await page.route("**/api/sync/scheduled?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          date: tomorrow,
          runCount: 1,
          runs: [{
            id: uniqueTestId("scheduled"),
            brand: scheduledBrand,
            flavor: scheduledFlavor,
            casesNeeded: 10,
            dieType: "",
          }],
        }]),
      }));

    await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-password-resets")).toBeVisible();
    await expect(page.getByTestId("manager-attention-incidents")).toBeVisible();
    await expect(page.getByTestId("manager-attention-recipe-setup")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-open.png") });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog", { name: "Manager attention" })).toBeHidden();
      await openManagerAttention(page);
    }

    await page.getByTestId("manager-attention-action-password-resets").click();
    await expect(page.getByRole("heading", { name: "Staff Roster" })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-incidents").click();
    await expect(page.getByRole("heading", { name: "Reported issues" })).toBeVisible();

    await openManagerAttention(page);
    await page.getByTestId("manager-attention-action-recipe-setup").click();
    await expect(page.getByRole("heading", { name: "Setup Profiles" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("manager-attention-destination.png") });
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await openManagerAttention(page);
    await expect(page.getByTestId("manager-attention-list")).toBeVisible();
    expect(browserErrors).toEqual([]);
  } finally {
    await fixtures.cleanup();
  }
});