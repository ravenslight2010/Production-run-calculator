import { Client } from "pg";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  DEFAULT_MANAGER_CAPABILITIES,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const API_BASE = requireLocalFixtureApiOrigin("Gold Lab approvals browser journey");
const PASSWORD = "GoldApprovalSynthetic123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const DIGEST = "a".repeat(64);

test("Gold Lab approval metadata lifecycle, authorization, errors, and responsive review", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(210_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const ownedRecordRefs: string[] = [];
  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(manager);
    const qcManager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_qc"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });
    await fixtures.assignQcManagerRole(qcManager);
    const staffWithCapability = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_staff"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });

    let failFirstList = true;
    await page.route("**/api/import-gold/approvals*", async (route) => {
      if (route.request().method() === "GET" && failFirstList) {
        // Keep the outage stable across mount/session refetches. Only the
        // deliberate retry below restores service; a second GET is not recovery.
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic temporary list failure" }),
        });
      } else {
        await route.continue();
      }
    });

    await openAs(page, manager.token);
    const settings = await openManageSettings(page);
    await expect(settings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const card = settings.getByTestId("import-gold-approvals");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("gold-approvals-load-error")).toContainText("Try again");
    failFirstList = false;
    await card.getByTestId("button-retry-gold-approvals").click();
    await expect(card.getByTestId("gold-approvals-empty")).toBeVisible();
    await page.unroute("**/api/import-gold/approvals*");
    await expectResponsiveBounds(card);

    await card.getByTestId("button-toggle-gold-approval-form").click();
    const form = card.getByTestId("gold-approval-form");
    await expect(form).toBeVisible();
    const mutationRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== "GET" && pathname.startsWith("/api/")) {
        mutationRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await form.getByTestId("input-gold-recordRef").fill("https://synthetic.invalid/private");
    await form.getByTestId("input-gold-sourceDigest").fill("ABC");
    await form.getByTestId("input-gold-recordRef").press("Enter");
    expect(mutationRequests).toEqual([]);
    await form.getByTestId("button-review-gold-approval").click();
    await expect(form.getByText(/Record reference must be an opaque ID/)).toBeVisible();
    await expect(form.getByText(/exactly 64 lowercase hex characters/)).toBeVisible();
    expect(mutationRequests).toEqual([]);

    const past = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 16);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString().slice(0, 16);
    const refs = {
      recordRef: uniqueTestId("synthetic-record"),
      ownerRef: uniqueTestId("synthetic-owner"),
      privacyReviewerRef: uniqueTestId("synthetic-reviewer"),
      conditionsRef: uniqueTestId("synthetic-conditions"),
      externalCopiesRef: uniqueTestId("synthetic-copies"),
      backupHandlingRef: uniqueTestId("synthetic-backup"),
    };
    ownedRecordRefs.push(refs.recordRef);
    for (const [key, value] of Object.entries(refs)) {
      await form.getByTestId(`input-gold-${key}`).fill(value);
    }
    await form.getByTestId("input-gold-sourceDigest").fill(DIGEST);
    await form.getByTestId("select-gold-importType").selectOption("spec");
    await form.getByTestId("select-gold-privacyStatus").selectOption("approved");
    await form.getByTestId("input-gold-ownerApprovedAt").fill(past);
    await form.getByTestId("input-gold-privacyReviewedAt").fill(past);
    await form.getByTestId("input-gold-validUntil").fill(future);
    await form.getByTestId("checkbox-gold-manualDeletionAccepted").check();
    await form.getByTestId("checkbox-gold-conditionsSatisfied").check();
    await form.getByTestId("button-review-gold-approval").click();
    const review = form.getByTestId("gold-approval-review");
    await expect(review).toBeVisible();
    for (const value of [...Object.values(refs), DIGEST, "local_spec_import_accuracy"]) {
      await expect(review).toContainText(value);
    }
    await expect(review).toContainText("30 days");
    await expect(review).toContainText("Retention");
    await expectResponsiveBounds(card);
    await card.screenshot({ path: testInfo.outputPath("approval-review-synthetic-metadata.png") });

    await form.getByTestId("button-submit-gold-approval").click();
    await expect(card.getByTestId("gold-approvals-notice")).toContainText("recorded as pending");
    const pending = card.locator('[data-testid^="gold-approval-"]').filter({ hasText: refs.recordRef });
    await expect(pending).toHaveCount(1);
    const pendingId = await pending.getAttribute("data-testid");
    expect(pendingId).toMatch(/^gold-approval-\d+$/);
    const id = pendingId!.replace("gold-approval-", "");
    await pending.getByTestId(`button-toggle-gold-approval-${id}`).click();
    await expect(pending.getByTestId(`gold-approval-status-${id}`)).toHaveText("Pending verification");
    await expectAllMetadata(pending, refs, DIGEST);
    const verifyButton = pending.getByTestId(`button-verify-gold-approval-${id}`);
    await expect(verifyButton).toBeDisabled();
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedSettings = await openManageSettings(page);
    await reloadedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const persistedPending = reloadedSettings.getByTestId("import-gold-approvals")
      .getByTestId(`gold-approval-${id}`);
    await expect(persistedPending).toBeVisible();
    await persistedPending.getByTestId(`button-toggle-gold-approval-${id}`).click();
    await expectAllMetadata(persistedPending, refs, DIGEST);
    await persistedPending.getByTestId(`checkbox-gold-attest-${id}`).check();
    await expect(persistedPending.getByTestId(`button-verify-gold-approval-${id}`)).toBeEnabled();
    await persistedPending.getByTestId(`button-verify-gold-approval-${id}`).click();
    await expect(persistedPending.getByTestId(`gold-approval-status-${id}`)).toHaveText("Verified");
    await expect(persistedPending).toContainText("Verified by");

    await page.reload({ waitUntil: "domcontentloaded" });
    const verifiedSettings = await openManageSettings(page);
    await verifiedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const verified = verifiedSettings.getByTestId("import-gold-approvals").getByTestId(`gold-approval-${id}`);
    await expect(verified.getByTestId(`gold-approval-status-${id}`)).toHaveText("Verified");
    await verified.getByTestId(`button-toggle-gold-approval-${id}`).click();
    await expectAllMetadata(verified, refs, DIGEST);
    await expect(verified.getByTestId(`checkbox-gold-attest-${id}`)).toHaveCount(0);
    await verified.getByTestId(`button-revoke-gold-approval-${id}`).click();
    const confirm = verified.getByRole("alertdialog", { name: `Confirm revoking approval ${id}` });
    await expect(confirm).toContainText("Revocation is permanent");
    await confirm.getByTestId(`button-cancel-revoke-gold-approval-${id}`).click();
    await expect(confirm).toHaveCount(0);
    await verified.getByTestId(`button-revoke-gold-approval-${id}`).click();
    await verified.getByRole("alertdialog").getByTestId(`button-confirm-revoke-gold-approval-${id}`).click();
    await expect(verified.getByTestId(`gold-approval-status-${id}`)).toHaveText("Revoked");
    await expect(verified).toContainText("Revoked by");
    await verified.screenshot({ path: testInfo.outputPath("approval-revoked-synthetic-metadata.png") });

    await page.reload({ waitUntil: "domcontentloaded" });
    const revokedSettings = await openManageSettings(page);
    await revokedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const revoked = revokedSettings.getByTestId("import-gold-approvals").getByTestId(`gold-approval-${id}`);
    await expect(revoked.getByTestId(`gold-approval-status-${id}`)).toHaveText("Revoked");
    await revoked.getByTestId(`button-toggle-gold-approval-${id}`).click();
    await expectAllMetadata(revoked, refs, DIGEST);
    await expect(revoked.getByTestId(`button-revoke-gold-approval-${id}`)).toHaveCount(0);

    const expiredFixtureRef = uniqueTestId("synthetic-expired-record");
    ownedRecordRefs.push(expiredFixtureRef);
    await createExpiredFixture(page, manager.token, { ...refs, recordRef: expiredFixtureRef });
    await page.reload({ waitUntil: "domcontentloaded" });
    const expiredListSettings = await openManageSettings(page);
    await expiredListSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const expiredRow = expiredListSettings.getByTestId("import-gold-approvals")
      .locator('[data-testid^="gold-approval-"]')
      .filter({ hasText: expiredFixtureRef });
    await expect(expiredRow.getByText("Expired", { exact: true })).toBeVisible();
    await expiredRow.getByRole("button", { name: "Review all fields" }).click();
    await expect(expiredRow).toContainText("Valid until");
    await expect(expiredRow.getByRole("button", { name: "Revoke approval" })).toBeVisible();
    await expectResponsiveBounds(expiredListSettings.getByTestId("import-gold-approvals"));
    await openAs(page, qcManager.token);
    const qcSettings = await openManageSettings(page);
    await expect(qcSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toBeVisible();

    await openAs(page, staffWithCapability.token);
    await expect(page.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    const staffSettings = await openManageSettings(page);
    await expect(staffSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);

    const noCapabilityManager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_manager_no_cap"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(noCapabilityManager);
    const db = new Client({ connectionString: requireIsolatedTestDatabase("verify manager without approval capability") });
    try {
      await db.connect();
      await db.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", ["[]"]);
    } finally {
      await db.end();
    }
    try {
      await openAs(page, noCapabilityManager.token);
      await expect(page.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
      const deniedSettings = await openManageSettings(page);
      await expect(deniedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    } finally {
      const restore = new Client({ connectionString: requireIsolatedTestDatabase("restore isolated manager capabilities") });
      try {
        await restore.connect();
        await restore.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)]);
      } finally {
        await restore.end();
      }
    }
  } finally {
    try {
      if (ownedRecordRefs.length > 0) {
        const cleanup = new Client({
          connectionString: requireIsolatedTestDatabase("remove synthetic Gold Lab approval fixtures"),
        });
        try {
          await cleanup.connect();
          await cleanup.query(
            "DELETE FROM import_gold_approvals WHERE scope = 'live' AND record_ref = ANY($1::text[])",
            [ownedRecordRefs],
          );
        } finally {
          await cleanup.end();
        }
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});

async function openAs(page: Page, token: string): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "rc_auth", value: token, url: API_BASE }]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function openManageSettings(page: Page) {
  await page.locator('button[title="More"]').click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Settings", exact: true }).click();
  return settings;
}

async function expectAllMetadata(
  row: ReturnType<Page["getByTestId"]>,
  refs: Record<string, string>,
  digest: string,
): Promise<void> {
  await expect(row).toContainText(refs.recordRef);
  for (const label of [
    "Record",
    "Evaluation digest",
    "Import type",
    "Purpose",
    "Owner",
    "Owner approved",
    "Privacy status",
    "Privacy reviewer",
    "Privacy reviewed",
    "Conditions",
    "External copies",
    "Backup handling",
    "Retention",
    "Conditions satisfied",
    "Valid until",
  ]) {
    await expect(row).toContainText(label);
  }
  await expect(row).toContainText(digest);
  for (const value of Object.values(refs)) await expect(row).toContainText(value);
}

async function createExpiredFixture(
  page: Page,
  token: string,
  refs: Record<string, string>,
): Promise<void> {
  const response = await page.request.post(`${API_BASE}/api/import-gold/approvals`, {
    headers: { Cookie: `rc_auth=${token}` },
    data: {
      recordRef: refs.recordRef,
      sourceDigest: DIGEST,
      importType: "spec",
      purpose: "local_spec_import_accuracy",
      ownerRef: refs.ownerRef,
      ownerApprovedAt: new Date(Date.now() - 3_600_000).toISOString(),
      privacyStatus: "approved",
      privacyReviewerRef: refs.privacyReviewerRef,
      privacyReviewedAt: new Date(Date.now() - 3_600_000).toISOString(),
      conditionsRef: refs.conditionsRef,
      externalCopiesRef: refs.externalCopiesRef,
      backupHandlingRef: refs.backupHandlingRef,
      manualDeletionAccepted: true,
      retentionDays: 30,
      conditionsSatisfied: true,
      validUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { approval: { id: number } };
  const db = new Client({ connectionString: requireIsolatedTestDatabase("seed expired Gold Lab approval fixture") });
  try {
    await db.connect();
    await db.query("UPDATE import_gold_approvals SET valid_until = NOW() - INTERVAL '1 day' WHERE id = $1", [payload.approval.id]);
  } finally {
    await db.end();
  }
}

async function expectResponsiveBounds(card: ReturnType<Page["getByTestId"]>): Promise<void> {
  const geometry = await card.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
}

test("expired metadata remains reviewable with correct role and capability gating at this viewport", async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(150_000);
  const fixtures = await AuthorizedBrowserFixtures.create(playwright, API_BASE, SIGNUP_CODE);
  const recordRef = uniqueTestId("synthetic-expired-record");
  let managerCapabilitiesChanged = false;
  try {
    const manager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_expired_manager"),
      password: PASSWORD,
      capabilities: DEFAULT_MANAGER_CAPABILITIES,
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(manager);
    const qcManager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_expired_qc"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });
    await fixtures.assignQcManagerRole(qcManager);
    const staffWithCapability = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_expired_staff"),
      password: PASSWORD,
      capabilities: ["manage-qc"],
      onboardingSeen: true,
    });
    const refs = {
      recordRef,
      ownerRef: uniqueTestId("synthetic-expired-owner"),
      privacyReviewerRef: uniqueTestId("synthetic-expired-reviewer"),
      conditionsRef: uniqueTestId("synthetic-expired-conditions"),
      externalCopiesRef: uniqueTestId("synthetic-expired-copies"),
      backupHandlingRef: uniqueTestId("synthetic-expired-backup"),
    };

    const managerIdentity = await page.request.get(`${API_BASE}/api/me`, {
      headers: { Cookie: `rc_auth=${manager.token}` },
    });
    expect(managerIdentity.ok()).toBeTruthy();
    expect(await managerIdentity.json()).toMatchObject({
      userId: manager.userId,
      role: "manager",
      capabilities: expect.arrayContaining(["manage-staff"]),
    });
    await createExpiredFixture(page, manager.token, refs);

    await openAs(page, manager.token);
    const settings = await openManageSettings(page);
    const approvalsTab = settings.getByRole("button", { name: "Gold Lab Approvals", exact: true });
    await expect(approvalsTab).toBeVisible();
    await approvalsTab.click();
    const card = settings.getByTestId("import-gold-approvals");
    await expect(card).toContainText("Metadata-only register. Enter opaque reference IDs only");
    await expect(card).toContainText("does not enable capture");
    const row = card.locator('[data-testid^="gold-approval-"]').filter({ hasText: recordRef });
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
    const approvalId = (await row.getAttribute("data-testid"))?.replace("gold-approval-", "");
    expect(approvalId).toMatch(/^\d+$/);
    await row.getByRole("button", { name: "Review all fields" }).click();
    await expectAllMetadata(row, refs, DIGEST);
    await expect(row.getByTestId(/^checkbox-gold-attest-/)).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Record verification" })).toHaveCount(0);
    await expectResponsiveBounds(card);
    await expectElementBounds(row);
    await card.screenshot({
      path: testInfo.outputPath("expired-approval-metadata-review.png"),
      animations: "disabled",
    });

    const qcIdentity = await page.request.get(`${API_BASE}/api/me`, {
      headers: { Cookie: `rc_auth=${qcManager.token}` },
    });
    expect(qcIdentity.ok()).toBeTruthy();
    expect(await qcIdentity.json()).toMatchObject({
      userId: qcManager.userId,
      role: "qc-manager",
      capabilities: expect.arrayContaining(["manage-qc"]),
    });
    await openAs(page, qcManager.token);
    const qcSettings = await openManageSettings(page);
    await qcSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true }).click();
    const qcCard = qcSettings.getByTestId("import-gold-approvals");
    await expect(qcCard.getByTestId(`gold-approval-${approvalId}`)).toBeVisible();

    const staffIdentity = await page.request.get(`${API_BASE}/api/me`, {
      headers: { Cookie: `rc_auth=${staffWithCapability.token}` },
    });
    expect(staffIdentity.ok()).toBeTruthy();
    const staffIdentityBody = await staffIdentity.json() as {
      userId?: string;
      role?: string;
      capabilities?: string[];
    };
    expect(staffIdentityBody).toMatchObject({
      userId: staffWithCapability.userId,
      capabilities: expect.arrayContaining(["manage-qc"]),
    });
    expect(staffIdentityBody.role).toMatch(/^e2e-role_/);
    expect(staffIdentityBody.role).not.toBe("manager");
    expect(staffIdentityBody.role).not.toBe("qc-manager");
    let approvalListRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/import-gold/approvals")) approvalListRequests += 1;
    });
    await openAs(page, staffWithCapability.token);
    await expect(page.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    const staffSettings = await openManageSettings(page);
    await expect(staffSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    expect(approvalListRequests).toBe(0);

    const noCapabilityManager = await fixtures.createAccount({
      username: uniqueTestId("gold_approval_expired_manager_no_cap"),
      password: PASSWORD,
      capabilities: [],
      onboardingSeen: true,
    });
    await fixtures.assignManagerRole(noCapabilityManager);
    const managerDb = new Client({
      connectionString: requireIsolatedTestDatabase("deny manager without Gold Lab approval capability"),
    });
    try {
      await managerDb.connect();
      await managerDb.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", ["[]"]);
      managerCapabilitiesChanged = true;
    } finally {
      await managerDb.end();
    }
    const deniedIdentity = await page.request.get(`${API_BASE}/api/me`, {
      headers: { Cookie: `rc_auth=${noCapabilityManager.token}` },
    });
    expect(deniedIdentity.ok()).toBeTruthy();
    expect(await deniedIdentity.json()).toMatchObject({
      userId: noCapabilityManager.userId,
      role: "manager",
      capabilities: [],
    });
    approvalListRequests = 0;
    await openAs(page, noCapabilityManager.token);
    await expect(page.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    const deniedSettings = await openManageSettings(page);
    await expect(deniedSettings.getByRole("button", { name: "Gold Lab Approvals", exact: true })).toHaveCount(0);
    expect(approvalListRequests).toBe(0);
  } finally {
    try {
      const cleanup = new Client({
        connectionString: requireIsolatedTestDatabase("remove expired synthetic approval and restore isolated manager role"),
      });
      try {
        await cleanup.connect();
        await cleanup.query(
          "DELETE FROM import_gold_approvals WHERE scope = 'live' AND record_ref = $1",
          [recordRef],
        );
        if (managerCapabilitiesChanged) {
          await cleanup.query(
            "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
            [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES)],
          );
        }
      } finally {
        await cleanup.end();
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});

async function expectElementBounds(element: Locator): Promise<void> {
  const geometry = await element.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
}
