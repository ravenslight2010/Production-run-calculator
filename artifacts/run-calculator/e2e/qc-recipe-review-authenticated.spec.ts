import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  AuthorizedBrowserFixtures,
  requireDedicatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { requireLocalFixtureApiOrigin } from "./isolatedApiOrigin";

const evidenceDir = resolve(process.cwd(), "../../.local/tasks/evidence/qc-slice-5-recipe-review");
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
] as const;

function safeDiagnostic(value: string): string {
  return value
    .replace(/rc_auth=[^&\s;]+/gi, "rc_auth=[redacted]")
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
    .slice(0, 260);
}

function attachBrowserDiagnostics(page: Page, errors: string[], routeFailures: string[]): void {
  page.on("pageerror", (error) => errors.push(safeDiagnostic(`${error.name}: ${error.message}`)));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/qc/recipe-review") && !url.pathname.endsWith("/api/dough-recipes")) return;
    if (response.status() >= 500) {
      routeFailures.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    }
  });
}

async function openSettings(page: Page, origin: string): Promise<void> {
  const bootstrapResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/master-data/bootstrap" &&
      (response.status() === 200 || response.status() === 304);
  });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await bootstrapResponse;
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Recipes", exact: true }).click();
  await dialog.getByRole("button", { name: "Dough", exact: true }).click();
  await expect(page.getByTestId("dough-recipe-editor")).toBeVisible();
}

async function openQc(page: Page, origin: string): Promise<void> {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "QC workflows & history", exact: true }).click();
}

async function openRecipeReview(page: Page): Promise<void> {
  await page.getByTestId("button-toggle-qc-recipe-review").click();
  await expect(page.getByTestId("qc-recipe-review")).toBeVisible();
}

async function saveEditorValue(page: Page, input: Locator, value: string) {
  await expect(input).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/dough-recipes") &&
    response.request().method() === "POST",
  );
  await input.fill(value);
  await input.press("Tab");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json() as {
    recipeQcReview?: { status: string; changedCount: number };
  };
  expect(body.recipeQcReview).toEqual({
    status: "applied-awaiting-review",
    changedCount: 1,
  });
  await expect(page.getByText("Applied — awaiting QC review", { exact: true })).toBeVisible();
  return body;
}

async function saveNotesThroughEditor(page: Page, note: string) {
  const input = page.getByTestId("dough-recipe-editor").getByPlaceholder(/Notes \(optional\)/);
  return saveEditorValue(page, input, note);
}

async function submitDecision(
  page: Page,
  status: "verified" | "rejected",
  reason: string,
): Promise<void> {
  const detail = page.getByTestId("qc-recipe-review-detail");
  await detail.getByLabel("Decision").selectOption(status);
  await detail.getByLabel("Reason").fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.includes("/api/qc/recipe-reviews/") &&
    new URL(response.url()).pathname.endsWith("/decisions") &&
    response.request().method() === "POST",
  );
  await page.getByTestId("button-save-recipe-qc-decision").click();
  const response = await responsePromise;
  if (status === "verified") expect(response.status()).toBe(201);
  else expect(response.status()).toBe(409);
}

async function fetchReviewQueue(
  api: APIRequestContext,
  apiOrigin: string,
  token: string,
  status: "pending" | "all",
): Promise<Array<{
  captureId: number;
  recipeId: string;
  status: string;
  resultHash: string;
}>> {
  const response = await api.get(`${apiOrigin}/api/qc/recipe-reviews?status=${status}&limit=50`, {
    headers: { Cookie: `rc_auth=${token}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json() as {
    items: Array<{ captureId: number; recipeId: string; status: string; resultHash: string }>;
  }).items;
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, `${testInfo.project.name}-recipe-review-${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 78, fullPage: false });
  await testInfo.attach(`recipe-review-${name}`, { path, contentType: "image/jpeg" });
}

test("editor-applied recipe revisions have scoped QC review, stale conflict protection, and reload persistence", async ({
  browser,
  playwright,
  baseURL,
}, testInfo) => {
  const apiOrigin = requireLocalFixtureApiOrigin("QC recipe-review synthetic verification");
  requireDedicatedTestDatabase("QC recipe-review synthetic verification");
  const runId = uniqueTestId("recipe-review-run");
  const date = new Date().toISOString().slice(0, 10);
  const recipeName = uniqueTestId("Synthetic QC dough");
  const diagnostics: string[] = [];
  const routeFailures: string[] = [];
  const contexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
  const checks = {
    editorAcknowledgement: "NOT REACHED",
    managerDecision: "NOT REACHED",
    staleConflictAndReload: "NOT REACHED",
    subsequentRevision: "NOT REACHED",
    responsiveKeyboardAndOverflow: "NOT REACHED",
    recordOnlyPrivacyAndDenial: "NOT REACHED",
    retention: "NOT REACHED",
  };
  let fixtures: Awaited<ReturnType<typeof AuthorizedBrowserFixtures.create>> | undefined;
  let apiRequest: APIRequestContext | undefined;
  let recipeId: string | null = null;
  let firstCaptureId: number | null = null;
  let latestCaptureId: number | null = null;
  let firstCaptureHash: string | null = null;
  let firstReviewStatus: string | null = null;
  let latestRevisionCount = 0;
  let cleanupStatus = "not started";

  try {
    fixtures = await AuthorizedBrowserFixtures.create(
      playwright,
      apiOrigin,
      process.env.STAFF_SIGNUP_CODE ?? "",
    );
    const editor = await fixtures.createAccount({
      username: uniqueTestId("recipe-editor"),
      password: "FixturePass123!",
      capabilities: ["manage-inventory"],
      onboardingSeen: true,
    });
    const manager1 = await fixtures.createAccount({
      username: uniqueTestId("recipe-qc-manager1"),
      password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"],
      onboardingSeen: true,
    });
    const manager2 = await fixtures.createAccount({
      username: uniqueTestId("recipe-qc-manager2"),
      password: "FixturePass123!",
      capabilities: ["record-qc", "manage-qc"],
      onboardingSeen: true,
    });
    const recorder = await fixtures.createAccount({
      username: uniqueTestId("recipe-qc-recorder"),
      password: "FixturePass123!",
      capabilities: ["record-qc"],
      onboardingSeen: true,
    });
    const api = await playwright.request.newContext();
    apiRequest = api;

    await fixtures.seedTodaySync({
      token: manager1.token,
      senderId: uniqueTestId("recipe-review-seed"),
      date,
      payload: {
        dayState: {
          date,
          runs: [{
            id: runId,
            brand: uniqueTestId("Synthetic recipe review brand"),
            flavor: "Synthetic only",
            casesNeeded: 1,
            seeded: false,
          }],
          currentIndex: 0,
          resetAt: 0,
          substitutions: [],
          substitutionLog: [],
          stagedItems: {},
        },
        runValues: {
          [runId]: {
            casesNeeded: 1,
            casesPerSkid: 12,
            pizzasPerCase: 12,
            doughRecipe: [],
            frontlineRecipe: [],
            app1Type: "",
            app2Type: "",
            app3Type: "",
            app4Type: "",
            pep1Type: "",
            pep1TypeB: "",
            pep2Type: "",
            pep2TypeB: "",
          },
        },
        runValuesUpdatedAt: { [runId]: Date.now() },
        packagingProgress: {},
      },
    });

    const origin = baseURL ?? process.env.PLAYWRIGHT_BASE_URL;
    if (!origin) throw new Error("Isolated Playwright base URL was not supplied.");
    const editorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const managerContext1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const managerContext2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const recorderContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(editorContext, managerContext1, managerContext2, recorderContext);
    for (const [context, account] of [
      [editorContext, editor],
      [managerContext1, manager1],
      [managerContext2, manager2],
      [recorderContext, recorder],
    ] as const) {
      await context.addCookies([{
        name: "rc_auth",
        value: account.token,
        url: new URL(origin).origin,
        httpOnly: true,
        sameSite: "Lax",
      }]);
    }
    const editorPage = await editorContext.newPage();
    const managerPage1 = await managerContext1.newPage();
    const managerPage2 = await managerContext2.newPage();
    const recorderPage = await recorderContext.newPage();
    for (const page of [editorPage, managerPage1, managerPage2, recorderPage]) {
      attachBrowserDiagnostics(page, diagnostics, routeFailures);
    }

    await openSettings(editorPage, origin);
    const createResponsePromise = editorPage.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/api/dough-recipes") &&
      response.request().method() === "POST",
    );
    await editorPage.getByTestId("dough-recipe-editor")
      .getByRole("button", { name: "Add Dough Recipe", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(200);
    const created = await createResponse.json() as {
      items?: Array<{ id?: string }>;
      recipeQcReview?: { status: string; changedCount: number };
    };
    expect(created.items?.length).toBeGreaterThan(0);
    expect(created.recipeQcReview).toEqual({
      status: "applied-awaiting-review",
      changedCount: 1,
    });
    const submitted = createResponse.request().postDataJSON() as {
      items?: Array<{ id?: string }>;
    };
    recipeId = submitted.items?.[0]?.id ?? null;
    expect(recipeId).toBeTruthy();
    expect(created.items?.some((item) => item.id === recipeId)).toBe(true);
    await expect(editorPage.getByText("Applied — awaiting QC review", { exact: true })).toBeVisible();
    await saveEditorValue(
      editorPage,
      editorPage.getByTestId("dough-recipe-editor").getByPlaceholder(/Recipe name/),
      recipeName,
    );
    await saveNotesThroughEditor(editorPage, "Synthetic applied revision one");
    checks.editorAcknowledgement = "PASS";

    const activeRecipeId = recipeId!;
    const initialCaptures = (await fetchReviewQueue(api, apiOrigin, manager1.token, "pending"))
      .filter((item) => item.recipeId === activeRecipeId);
    expect(initialCaptures).toHaveLength(1);
    firstCaptureId = initialCaptures[0]!.captureId;
    firstCaptureHash = initialCaptures[0]!.resultHash;

    for (const page of [managerPage1, managerPage2]) {
      await openQc(page, origin);
      await openRecipeReview(page);
      const item = page.getByTestId(`qc-recipe-review-item-${firstCaptureId}`);
      await expect(item).toBeVisible();
      await item.click();
      await expect(page.getByTestId("qc-recipe-review-detail")).toContainText("pending");
    }
    await submitDecision(
      managerPage1,
      "verified",
      "Synthetic manager verification of the first applied revision.",
    );
    await expect(managerPage1.getByTestId("qc-recipe-review-detail"))
      .toContainText("Recipe revision verified and saved. The recipe remains applied.");
    checks.managerDecision = "PASS";

    await submitDecision(
      managerPage2,
      "rejected",
      "Synthetic stale decision from a second authenticated context.",
    );
    await expect(managerPage2.getByTestId("qc-recipe-review-error"))
      .toContainText("review history changed");
    await managerPage2.getByRole("button", { name: "Refresh evidence" }).click();
    await expect(managerPage2.getByTestId("qc-recipe-review-detail")).toContainText("verified");
    await managerPage2.reload();
    await openQc(managerPage2, origin);
    await openRecipeReview(managerPage2);
    await managerPage2.getByTestId("qc-recipe-review")
      .getByLabel("Recipe review queue status").selectOption("all");
    await managerPage2.getByTestId(`qc-recipe-review-item-${firstCaptureId}`).click();
    await expect(managerPage2.getByTestId("qc-recipe-review-detail")).toContainText(
      "Synthetic manager verification of the first applied revision.",
    );
    firstReviewStatus = "verified";
    checks.staleConflictAndReload = "PASS";

    await saveNotesThroughEditor(editorPage, "Synthetic applied revision two");
    const captures = (await fetchReviewQueue(api, apiOrigin, manager1.token, "all"))
      .filter((item) => item.recipeId === activeRecipeId);
    expect(captures.length).toBeGreaterThanOrEqual(2);
    latestRevisionCount = captures.length;
    const currentPending = captures.filter((item) => item.status === "pending");
    expect(currentPending).toHaveLength(1);
    latestCaptureId = currentPending[0]!.captureId;
    expect(currentPending[0]!.resultHash).not.toBe(firstCaptureHash);
    expect(captures.find((item) => item.captureId === firstCaptureId)?.status).toBe("superseded");

    await openQc(managerPage1, origin);
    await openRecipeReview(managerPage1);
    const latestItem = managerPage1.getByTestId(`qc-recipe-review-item-${latestCaptureId}`);
    await expect(latestItem).toBeVisible();
    await latestItem.click();
    await expect(managerPage1.getByTestId("qc-recipe-review-detail")).toContainText("pending");
    checks.subsequentRevision = "PASS";

    for (const viewport of viewports) {
      await managerPage1.setViewportSize({ width: viewport.width, height: viewport.height });
      const review = managerPage1.getByTestId("qc-recipe-review");
      await expect(review).toBeVisible();
      const detail = managerPage1.getByTestId("qc-recipe-review-detail");
      await expect(detail.getByLabel("Decision")).toBeVisible();
      await expect(detail.getByLabel("Reason")).toBeVisible();
      await detail.getByLabel("Reason").focus();
      expect(await detail.getByLabel("Reason").evaluate((element) =>
        document.activeElement === element,
      )).toBe(true);
      const dimensions = await review.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      await attachViewportScreenshot(managerPage1, testInfo, viewport.name);
    }
    checks.responsiveKeyboardAndOverflow = "PASS";

    await openQc(recorderPage, origin);
    await openRecipeReview(recorderPage);
    const statusPanel = recorderPage.getByTestId("qc-recipe-review");
    await expect(statusPanel).toContainText(recipeName);
    await expect(statusPanel).not.toContainText("Recipe review queue");
    await expect(statusPanel).not.toContainText("revision hash");
    const denied = await api.get(`${apiOrigin}/api/qc/recipe-reviews`, {
      headers: { Cookie: `rc_auth=${recorder.token}` },
    });
    expect(denied.status()).toBe(403);
    checks.recordOnlyPrivacyAndDenial = "PASS";

    const persisted = await api.get(`${apiOrigin}/api/dough-recipes`, {
      headers: { Cookie: `rc_auth=${editor.token}` },
    });
    expect(persisted.status()).toBe(200);
    const recipeList = await persisted.json() as { items: Array<{ id: string; notes: string }> };
    expect(recipeList.items.find((item) => item.id === activeRecipeId)?.notes)
      .toBe("Synthetic applied revision two");
    checks.retention = "PASS";
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await apiRequest?.dispose().catch(() => {});
    if (fixtures) {
      cleanupStatus = "attempted against isolated disposable database";
      await fixtures.cleanup({
        syncDates: [date],
        doughRecipeIds: recipeId ? [recipeId] : [],
      })
        .catch((error) => {
          cleanupStatus = "FAILED against isolated disposable database";
          diagnostics.push(safeDiagnostic(`fixture cleanup: ${String(error)}`));
        });
    }
    mkdirSync(evidenceDir, { recursive: true });
    const report = {
      environment: "isolated disposable PostgreSQL and local browser servers",
      sourceRevision: (() => {
        try {
          return `${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()} (working tree under test)`;
        } catch {
          return "revision unavailable";
        }
      })(),
      runIdentity: testInfo.testId,
      browserEngine: testInfo.project.name,
      viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
      physicalAndroidChrome: "NOT RUN",
      physicalIosSafariPwa: "NOT RUN",
      checks,
      firstCaptureId,
      latestCaptureId,
      latestRevisionCount,
      firstReviewStatus,
      routeFailures,
      diagnostics,
      cleanupStatus,
      credentialsOrRawTraces: "not retained",
    };
    writeFileSync(
      resolve(evidenceDir, `${testInfo.project.name}-recipe-review-result.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await testInfo.attach("sanitized-recipe-review-result", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(report, null, 2)),
    });
  }
});
