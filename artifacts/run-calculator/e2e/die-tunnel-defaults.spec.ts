/**
 * E2E: selecting a die applies compatible line defaults without overwriting
 * an explicit Press/Oven or Frontline split.
 *
 * This deliberately exercises the rendered Run form instead of testing the
 * resolver directly. The latter is covered by dieDefaults.test.ts; this test
 * protects the form wiring and the values visible in the controlled inputs.
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, requireIsolatedTestDatabase } from "./isolation";
import { signUpAndHandleOnboarding } from "./onboarding";

function uid(): string {
  return `e2edie${Math.random().toString(36).slice(2, 9)}`;
}

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
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
  const mode = page.getByRole("button", { name: /^(Operator|Supervisor)$/ });
  await expect(mode).toBeVisible();
  if ((await mode.innerText()).trim() === "Operator") {
    await mode.click();
    await page.getByRole("heading", { name: "Supervisor Access" }).waitFor({ state: "visible" });
    await page.locator('input[type="password"]').fill("1234");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
  }

  // Die selection and the line-setting inputs are part of the Run tab's
  // collapsed Line Setup section.
  await page.locator('[data-testid="tab-run"]').click();
  await page.locator("summary", { hasText: "Line Setup" }).click();
  await page.getByText("Die Type", { exact: true }).waitFor({ state: "visible" });
}

async function seedDieTypes(): Promise<void> {
  const db = new Client({
    connectionString: requireIsolatedTestDatabase("die tunnel defaults fixture"),
  });
  try {
    await db.connect();
    for (const name of ['7" Dies', '12"']) {
      await db.query(
        `INSERT INTO die_types (id, scope, name, created_at, updated_at)
         VALUES ($1, 'live', $2, NOW(), NOW())
         ON CONFLICT (id, scope) DO UPDATE
           SET name = EXCLUDED.name, updated_at = NOW()`,
        [name.toLowerCase(), name],
      );
    }
  } finally {
    await db.end().catch(() => {});
  }
}

test.describe("run-form die defaults and split timer", () => {
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
    // Seed through the disposable database because a later serial-suite user
    // is correctly denied the manager-only master-data endpoint.
    await seedDieTypes();
    await page.reload({ waitUntil: "domcontentloaded" });
    await openRunForm(page);

    const pressOven = page.getByLabel("Press / Oven transit (min)");
    const frontline = page.getByLabel("Frontline transit (min)");
    const packaging = page.getByLabel("Wrapper / Packaging transit (min)");
    const die7 = page.getByRole("button", { name: '7" Dies', exact: true });
    const die12 = page.getByRole("button", { name: '12"', exact: true });

    await die7.click();
    await expect(pressOven).toHaveValue("1.75");
    await expect(frontline).toHaveValue("1.75");
    await expect(packaging).toHaveValue("3");

    await die12.click();
    await expect(pressOven).toHaveValue("1");
    await expect(frontline).toHaveValue("1");
    await expect(packaging).toHaveValue("2");

    // An explicitly edited split remains operator-owned across die changes;
    // applying a legacy die default must not collapse it back to one combined
    // pre-tunnel value.
    await pressOven.fill("4.8");
    await die7.click();
    await expect(pressOven).toHaveValue("4.8");
    await expect(frontline).toHaveValue("1");
    await expect(packaging).toHaveValue("3");
    await expect(page.locator('[data-testid="line-transit-total"]')).toContainText("Press / Oven carries pairs");
  });

  test("keeps the split through a paired run, pause/resume, reload, and an independent browser", async ({
    page, browser,
  }) => {
    const username = uid();
    testUsernames.add(username);
    await signUpAndDismissOnboarding(page, username, "TestPass123!");
    await openRunForm(page);
    // Use the selected run's real editing/save path. Replacing a daily_sync row
    // behind a connected client can leave a different blank run selected.
    await page.getByRole("button", { name: "Dough", exact: true }).click();
    await page.getByTestId("input-casesNeeded").fill("50");
    await page.getByRole("spinbutton", { name: "Crusts Per Cycle", exact: true }).fill("2");
    await page.getByRole("spinbutton", { name: "Cycle Speed (cyc/min)", exact: true }).fill("10");
    await page.getByRole("spinbutton", { name: "Speed Adjustment", exact: true }).fill("1");
    await page.getByRole("spinbutton", { name: "Freeze tunnel time (min)", exact: true }).fill("10");
    await page.getByRole("spinbutton", { name: "Pizzas Per Case", exact: true }).fill("12");
    await page.getByRole("spinbutton", { name: "Cases Per Skid", exact: true }).fill("10");

    const pressOven = page.getByLabel("Press / Oven transit (min)");
    const frontline = page.getByLabel("Frontline transit (min)");
    await pressOven.fill("0.1");
    await frontline.fill("0.1");
    await frontline.blur();
    const runId = (await page.getByTestId("run-identity").getAttribute("data-run-id"))!;
    expect(runId).toBeTruthy();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/sync/today?today=${localDate()}`);
      if (!response.ok()) return false;
      const saved = await response.json();
      // Bind to the rendered owner, not server currentIndex or another
      // project run with coincidentally equal settings.
      const value = saved.runValues?.[runId];
      if (!value || value.casesNeeded !== 50 || value.crustsPerCycle !== 2 ||
        value.cycleSpeed !== 10 || value.pressOvenMin !== 0.1 || value.frontlineMin !== 0.1) return false;
      return true;
    }, { timeout: 20_000 }).toBe(true);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      for (const input of [pressOven, frontline]) {
        await input.scrollIntoViewIfNeeded();
        const box = await input.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
    await expect(page.locator('[data-testid="line-transit-total"]'))
      .toContainText(/Press \/ Oven carries pairs.*Frontline carries single pizzas/);

    await page.getByTestId("button-start-run").click();
    const pauseButton = page.getByRole("button", { name: /pause run/i });
    await pauseButton.waitFor({ state: "visible", timeout: 10_000 });
    const phases = page.getByTestId("line-phase-strip");
    const pressRow = phases.getByText(/Press \/ Oven/);
    const frontlineFillRow = phases.getByText(/Frontline — filling →/);
    await expect(pressRow).toBeVisible({ timeout: 10_000 });
    await expect(frontlineFillRow).toBeVisible({ timeout: 10_000 });
    // Pause after this section is full; a just-arrived partial fill can have a
    // drain window shorter than browser polling, which belongs in unit tests.
    await expect(frontlineFillRow).toBeHidden({ timeout: 10_000 });

    await pauseButton.click();
    await expect(page.getByTestId("pause-tunnel-decision")).toBeVisible();
    const pauseChoice = page.getByTestId("pause-stop-tunnel-yes");
    await pauseChoice.scrollIntoViewIfNeeded();
    await pauseChoice.click({ timeout: 4_000 });
    await expect(page.getByTestId("resume-run")).toBeVisible();
    await expect(phases.getByText(/Frontline — draining/)).toBeVisible({ timeout: 10_000 });
    await expect(phases.getByText(/Freeze Tunnel — stopped/)).toBeVisible({ timeout: 20_000 });

    const today = localDate();
    const snapshot = async () => {
      const response = await page.request.get(`/api/sync/today?today=${today}`);
      expect(response.ok()).toBe(true);
      return response.json() as Promise<{
        runValues?: Record<string, Record<string, number>>;
      }>;
    };
    const beforeReload = await snapshot();
    expect(beforeReload.runValues?.[runId]).toMatchObject({
      pressOvenMin: 0.1,
      frontlineMin: 0.1,
    });
    const completedBeforeReload = beforeReload.runValues?.[runId]?.casesOnCurrentSkid ?? 0;

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(phases.getByText(/Press \/ Oven/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Press / Oven transit (min)")).toHaveValue("0.1");
    await expect(page.getByLabel("Frontline transit (min)")).toHaveValue("0.1");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      await phases.scrollIntoViewIfNeeded();
      const box = await phases.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.getByTestId("tab-frontline").click();
      const compact = page.getByTestId("compact-run-strip");
      // The compact summary intentionally selects the relevant non-empty
      // section, not every row. Upstream sections are empty after this drain.
      await expect(compact).toContainText("Freeze Tunnel — stopped");
      const compactBox = await compact.boundingBox();
      expect(compactBox).not.toBeNull();
      expect(compactBox!.x).toBeGreaterThanOrEqual(0);
      expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.getByTestId("tab-run").click();
    }
    await test.info().attach("reloaded-four-section-timer", {
      body: await phases.screenshot(),
      contentType: "image/png",
    });

    // Same authenticated actor, independent browser storage and sync lifecycle.
    // Copy cookies only, never the original context's localStorage.
    const peerContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: { cookies: await page.context().cookies(), origins: [] },
    });
    const secondTab = await peerContext.newPage();
    try {
      await secondTab.goto("/", { waitUntil: "domcontentloaded" });
      await secondTab.locator('[title="Sync connected"]').waitFor({ state: "visible", timeout: 20_000 });
      await expect(secondTab.getByText("Confirmed server baseline", { exact: true }))
        .toBeVisible({ timeout: 20_000 });
      // Selection is device-local: a cold browser may initially select its
      // pending blank run. Select the same canonical run through normal UI.
      const peerResponse = await secondTab.request.get(`/api/sync/today?today=${today}`);
      expect(peerResponse.ok()).toBe(true);
      const peerDocument = await peerResponse.json();
      const peerIndex = peerDocument.dayState.runs.findIndex((run: { id: string }) => run.id === runId);
      expect(peerIndex).toBeGreaterThanOrEqual(0);
      // A cold client can have its own blank selected before that blank has
      // reached the server. Server run count cannot decide whether to switch.
      if (await secondTab.getByTestId("run-identity").getAttribute("data-run-id") !== runId) {
        await secondTab.getByRole("button", { name: `Select run ${peerIndex + 1}`, exact: true }).click();
      }
      await expect(secondTab.getByTestId("run-identity")).toHaveAttribute("data-run-id", runId);
      const peerPhases = secondTab.getByTestId("line-phase-strip");
      await expect(peerPhases.getByText(/Press \/ Oven/)).toBeVisible({ timeout: 20_000 });
      await expect(peerPhases.getByText(/Frontline/)).toBeVisible();
      await expect(secondTab.getByLabel("Press / Oven transit (min)")).toHaveValue("0.1");
      await expect(secondTab.getByLabel("Frontline transit (min)")).toHaveValue("0.1");
      await expect(secondTab.getByTestId("resume-run")).toBeVisible();
      const afterReload = await snapshot();
      expect(afterReload.runValues?.[runId]?.casesOnCurrentSkid ?? 0)
        .toBe(completedBeforeReload);
      expect(afterReload.runValues?.[runId]).toMatchObject({
        pressOvenMin: 0.1,
        frontlineMin: 0.1,
      });
      // Compare counters while safely paused, not after legitimate running
      // production could have advanced. Then prove resume propagates to peer.
      await page.getByTestId("resume-run").click();
      await expect(pauseButton).toBeVisible({ timeout: 10_000 });
      await expect(secondTab.getByRole("button", { name: /pause run/i })).toBeVisible({ timeout: 20_000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(pauseButton).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel("Press / Oven transit (min)")).toHaveValue("0.1");
      await expect(page.getByLabel("Frontline transit (min)")).toHaveValue("0.1");
    } finally {
      await peerContext.close();
    }
  });
});