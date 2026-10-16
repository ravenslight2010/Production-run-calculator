import { expect, test } from "@playwright/test";
import { Client } from "pg";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";

const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL!;
let fixtures: AuthorizedBrowserFixtures;

test.beforeAll(async ({ playwright }) => {
  requireIsolatedTestDatabase("field-check diagnostic manager view");
  fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, process.env.STAFF_SIGNUP_CODE!);
});
test.afterAll(async () => { await fixtures?.cleanup(); });

test("manager sees safe sync categories and performance sources from isolated API evidence", async ({ page, request }, testInfo) => {
  const account = await fixtures.createAccount({
    username: uniqueTestId("field_diagnostics"), password: "TestPass123!",
    capabilities: DEFAULT_MANAGER_CAPABILITIES,
  });
  // This suite owns only diagnostic tables in a disposable database, not production runs.
  const db = new Client({ connectionString: requireIsolatedTestDatabase("clear isolated diagnostic fixtures") });
  try {
    await db.connect();
    await db.query("TRUNCATE field_check_observations, field_check_issues");
  } finally { await db.end(); }
  const samples = [
    ...[1, 2, 3].map((failureCode) => ({ checkName: "sync-acknowledgment", metrics: { failureCode } })),
    ...[1, 2, 3, 4].map((sourceCode) => ({ checkName: "performance", metrics: { sourceCode, durationMs: 20_000 + sourceCode } })),
  ].map((sample, index) => ({
    ...sample, observationId: `${uniqueTestId("field_view")}-${index}`, checkVersion: "3",
    outcome: "failure", observedAt: new Date(Date.now() - index * 1000).toISOString(),
    appBuild: "local", deviceCategory: "mobile-chrome",
  }));
  const result = await request.post(`${API_BASE}/api/field-checks/observations`, {
    headers: { Authorization: `Bearer ${account.token}` }, data: { observations: samples },
  });
  expect(result.status()).toBe(202);
  // Passive observations from this test browser must not recover the seeded failures.
  await page.route("**/api/field-checks/observations", (route) => route.fulfill({
    status: 202, json: { accepted: 0, duplicate: 0 },
  }));
  await page.context().addCookies([{ name: "rc_auth", value: account.token, url: API_BASE }]);
  await page.goto("/");
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Reported issues" }).click();
  const failures = page.getByLabel("Actionable field-check failures");
  await expect(failures).toBeVisible();
  for (const label of ["Login or permission rejected", "Server rejected a stale/reset write", "Sync retries exhausted",
    "Home bundle load · 20001 ms", "Page navigation load · 20002 ms", "API timeout / abort · 20003 ms"]) {
    await expect(failures.getByText(label, { exact: true })).toBeVisible();
  }
  // The UI intentionally shows three failures per check; the API retains all four sources.
  const report = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  const data = await report.json();
  expect(data.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
    .toEqual(expect.arrayContaining([expect.objectContaining({ metrics: { sourceCode: 4, durationMs: 20004 } })]));
  expect(await failures.innerText()).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\//);
  await expect(failures.getByText("Unidentified local build; not release verification evidence.").first()).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Download safe field-check report" });
  await expect(downloadButton).toBeVisible();
  // Launch failure is visible, never deletes or recovers the retained observations.
  const before = await failures.innerText();
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error("isolated download failure"); };
    (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl = () => { URL.createObjectURL = original; };
  });
  await downloadButton.click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toBeVisible();
  expect(await failures.innerText()).toBe(before);
  await page.evaluate(() => (window as unknown as { restoreExportUrl: () => void }).restoreExportUrl());
  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^field-check-report-v1-\d{4}-[\dTZ-]+\.json$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(Buffer.byteLength(text)).toBeLessThan(64_000);
  expect(text).not.toMatch(/Bearer|field_view|field_diagnostics|\/api\/|observationId|userId|clientId|runId/);
  const exported = JSON.parse(text);
  expect(exported).toMatchObject({ schemaVersion: 1, facilityScope: "current facility",
    provenance: { kind: "advisory-field-evidence", environment: "unknown", buildIdentity: "unknown" } });
  expect(exported.checks.find((check: { name: string }) => check.name === "performance").recentFailures)
    .toEqual(expect.arrayContaining([expect.objectContaining({
      buildCategory: "unknown-local", deviceCategory: "mobile-chrome",
      diagnostics: expect.objectContaining({ sourceCode: 4, durationMs: 20004 }),
    })]));
  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t download the report" })).toHaveCount(0);
  expect(await failures.innerText()).toBe(before);
  const after = await request.get(`${API_BASE}/api/field-checks`, { headers: { Authorization: `Bearer ${account.token}` } });
  expect((await after.json()).checks).toEqual(data.checks);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  await failures.screenshot({ path: testInfo.outputPath("safe-field-check-details.png") });
  const restricted = await fixtures.createAccount({
    username: uniqueTestId("field_no_review"), password: "TestPass123!",
    capabilities: DEFAULT_MANAGER_CAPABILITIES.filter((capability) => capability !== "review-incidents"),
  });
  const denied = await request.get(`${API_BASE}/api/field-checks`, {
    headers: { Authorization: `Bearer ${restricted.token}` },
  });
  expect(denied.status()).toBe(403);
  await page.context().addCookies([{ name: "rc_auth", value: restricted.token, url: API_BASE }]);
  await page.reload();
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
  await expect(downloadButton).toHaveCount(0);
  await page.getByRole("button", { name: /^More/ }).click();
  await expect(page.getByRole("menuitem", { name: "Reported issues" })).toHaveCount(0);
});
