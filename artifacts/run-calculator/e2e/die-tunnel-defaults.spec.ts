/**
 * E2E: selecting a die on the run form applies its tunnel defaults.
 *
 * This deliberately exercises the rendered Run form instead of testing the
 * resolver directly. The latter is covered by dieDefaults.test.ts; this test
 * protects the form wiring and the values visible in the controlled inputs.
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers } from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

function uid(): string {
  return `e2edie${Math.random().toString(36).slice(2, 9)}`;
}

const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "Welcome2Lucias!";
const testUsernames = new Set<string>();

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

async function signUpAndDismissOnboarding(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await signUpAndHandleOnboarding(page, username, password, {
    signupCode: SIGNUP_CODE,
    onboarding: {
      afterComplete: async (currentPage) => {
        await currentPage
          .locator('[data-state="open"][aria-hidden="true"]')
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
      },
    },
  });
}

async function openRunForm(page: Page): Promise<void> {
  // Line settings are supervisor-gated. Fresh test users can unlock the
  // local supervisor mode with the documented default PIN.
  await page.getByRole("button", { name: "Operator" }).click();
  await page.getByRole("heading", { name: "Supervisor Access" }).waitFor({ state: "visible" });
  await page.locator('input[type="password"]').fill("1234");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();

  // Die selection and the line-setting inputs are part of the Run tab's
  // collapsed Line Setup section.
  await page.locator('[data-testid="tab-run"]').click();
  await page.locator("summary", { hasText: "Line Setup" }).click();
  await page.getByText("Die Type", { exact: true }).waitFor({ state: "visible" });
}

test.describe("run-form die tunnel defaults", () => {
  test("fills 7-inch values, switches to 12-inch values, and preserves typed time", async ({
    page,
  }) => {
    // The fresh test account has no factory die pool yet. Seed only the
    // browser-local picker list; the app's normal reconciliation then exposes
    // these exact options in the rendered form.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "run-calc-die-types",
        JSON.stringify(['7" Dies', '12"']),
      );
    });

    const username = uid();
    testUsernames.add(username);
    await signUpAndDismissOnboarding(page, username, "TestPass123!");
    // Make the two options available in the factory pool as well as the
    // browser cache. This keeps the test independent of whatever die names
    // another local test run may have left on the development database.
    await page.evaluate(async () => {
      const response = await fetch("/api/die-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: ['7" Dies', '12"'] }),
      });
      if (!response.ok) throw new Error(`Unable to seed die types (${response.status})`);
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await openRunForm(page);

    const preTunnel = page.getByLabel("Pre-tunnel (min)");
    const postTunnel = page.getByLabel("Post-tunnel (min)");
    const die7 = page.getByRole("button", { name: '7" Dies', exact: true });
    const die12 = page.getByRole("button", { name: '12"', exact: true });

    await die7.click();
    await expect(preTunnel).toHaveValue("3.5");
    await expect(postTunnel).toHaveValue("3");

    await die12.click();
    await expect(preTunnel).toHaveValue("2");
    await expect(postTunnel).toHaveValue("2");

    // A value that is no die's generated default is treated as operator-owned.
    // Switching again must not overwrite it, while the untouched companion
    // field continues to follow the newly selected die.
    await preTunnel.fill("4.8");
    await die7.click();
    await expect(preTunnel).toHaveValue("4.8");
    await expect(postTunnel).toHaveValue("3");
  });
});