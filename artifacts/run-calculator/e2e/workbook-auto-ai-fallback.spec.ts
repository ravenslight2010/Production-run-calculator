import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import * as XLSX from "xlsx";
import { expect, test, type Page } from "@playwright/test";
import {
  gridsToPromptText,
  mergeParsedSpecImports,
  splitGridsForPrompt,
  type ParsedSpecImport,
  type SheetGrid,
} from "@workspace/spec-import";
import { buildExportWorkbook } from "../src/specExportWorkbook";
import { getWorkbookAuditFailureEntries } from "./workbookAuditEvidence.mjs";
import { cleanupTestUsers, requireIsolatedTestDatabase, uniqueTestId } from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const repoRoot = path.resolve(process.cwd(), "../..");
const evidenceDir = path.join(repoRoot, ".local/evidence/workbook-import-audit");
const testUsernames = new Set<string>();
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const PASSWORD = "WorkbookAuditFixture123!";
const EXPECTED_MAURO_PRODUCTS = [
  "PEPPERONI HONEY G",
  "TOMATO BASIL",
  "ITALIAN BEEF & GIARDINIERA",
];

type BrowserName = "chromium" | "webkit";

function workbookGrids(buffer: Buffer): SheetGrid[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) return [];
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: true,
      range: { s: { r: 0, c: 0 }, e: range.e },
    });
    return [{
      name,
      rows: rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => cell == null ? "" : String(cell)) : [],
      ),
    }];
  });
}

function sourceTextForBuffer(buffer: Buffer): string {
  return workbookGrids(buffer)
    .map((grid) => gridsToPromptText([grid]))
    .join("\n\n");
}

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function summarizeParse(parsed: ParsedSpecImport, sourceText: string) {
  const profiles = parsed.profiles ?? [];
  const recipes = parsed.recipes ?? [];
  const recipeRows = recipes.flatMap((recipe) => recipe.rows ?? []);
  const sourceKey = normalizeEvidenceText(sourceText);
  const sourceContains = (value: string) => {
    const key = normalizeEvidenceText(value);
    return !key || sourceKey.includes(key);
  };
  return {
    profileCount: profiles.length,
    recipeCount: recipes.length,
    recipeRowCount: recipeRows.length,
    numericWeightRowCount: recipeRows.filter(
      (row) => Number.isFinite(Number(row.lbs)),
    ).length,
    recipesWithUnits: recipes.filter((recipe) => Boolean(recipe.rowsUnit)).length,
    recipesMissingUnits: recipes.filter((recipe) => !recipe.rowsUnit).length,
    rowsWithSourceLocations: recipeRows.filter(
      (row) => Boolean(row.sourceLocations?.length),
    ).length,
    profilesWithSourceNameEvidence: profiles.filter(
      (profile) => sourceContains(profile.flavor) && sourceContains(profile.brand),
    ).length,
    recipesWithSourceNameEvidence: recipes.filter(
      (recipe) => sourceContains(recipe.name),
    ).length,
    profileNamesNotFoundInSource: profiles.filter(
      (profile) => !sourceContains(profile.brand) || !sourceContains(profile.flavor),
    ).length,
    recipeNamesNotFoundInSource: recipes.filter(
      (recipe) => !sourceContains(recipe.name),
    ).length,
    ingredientNamesNotFoundInSource: recipeRows.filter(
      (row) => !sourceContains(row.ingredient),
    ).length,
    profileSourceCellCount: profiles.reduce(
      (count, profile) => count + Object.values(profile.sourceLocations ?? {})
        .reduce((sum, locations) => sum + locations.length, 0),
      0,
    ),
    recipeSourceCellCount: recipes.reduce(
      (count, recipe) => count + Object.values(recipe.sourceLocations ?? {})
        .reduce((sum, locations) => sum + locations.length, 0),
      0,
    ),
    profileDoughAssociationCount: profiles.filter((profile) => Boolean(profile.doughName)).length,
    profileSauceAssociationCount: profiles.filter((profile) => Boolean(profile.sauceName)).length,
    profileApplicatorCount: profiles.reduce(
      (count, profile) => count + (profile.applicators?.length ?? 0),
      0,
    ),
    profilePepperoniCount: profiles.reduce(
      (count, profile) => count + (profile.pepperonis?.length ?? 0),
      0,
    ),
    recipeKindCounts: recipes.reduce<Record<string, number>>((counts, recipe) => {
      counts[recipe.kind] = (counts[recipe.kind] ?? 0) + 1;
      return counts;
    }, {}),
    warningCount: parsed.warnings?.length ?? 0,
    unresolvedCount: parsed.unresolved?.length ?? 0,
  };
}

async function promoteToManager(username: string, allowAi = true): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(user.rows[0]?.id, "sign-up did not create a database user").toBeTruthy();
    await db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager', updated_at = NOW()`,
      [user.rows[0]!.id],
    );
    const capabilities = [
      "manage-inventory",
      "manage-profiles",
      "review-incidents",
      "manage-factory-settings",
      ...(allowAi ? ["use-ai-tools"] : []),
    ];
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
      [JSON.stringify(capabilities)],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function signInManager(page: Page, allowAi = true): Promise<string> {
  const username = uniqueTestId("workbook_import_manager");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
  await promoteToManager(username, allowAi);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page, { visibilityTimeout: 5_000 });
  return username;
}

async function openWorkbookImport(page: Page): Promise<void> {
  await page.locator('button[title="More"]').click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Manage Lists" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Tools", exact: true }).click();
  await settings.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("spec-workbook-ai-disclosure")).toBeVisible();
  await settings.getByRole("button", { name: "Import Spec Sheet", exact: true }).click();
}

async function masterDataCounts(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const endpoints = [
      "/api/brand-profiles",
      "/api/dough-recipes",
      "/api/sauce-recipes",
      "/api/cheese-recipes",
      "/api/mixes",
    ];
    const values = await Promise.all(endpoints.map(async (endpoint) => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(`Master-data read failed (${response.status})`);
      return [endpoint, await response.json() as unknown] as const;
    }));
    return Object.fromEntries(values);
  });
  const serialized = JSON.stringify(snapshot);
  return {
    counts: Object.fromEntries(
      Object.entries(snapshot).map(([endpoint, value]) => [
        endpoint,
        Array.isArray(value) ? value.length : null,
      ]),
    ),
    snapshotSha256: createHash("sha256").update(serialized).digest("hex"),
    snapshot,
  };
}

async function saveBrowserEvidence(name: string, value: unknown): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function chooseWorkbook(page: Page, filePath: string): Promise<void> {
  await page.getByTestId("spec-workbook-input").setInputFiles(filePath);
}

function deterministicExportBytes(): Buffer {
  const workbook = buildExportWorkbook([{
    name: "Products",
    rows: [
      ["Brand", "Flavor", "Die Type"],
      ["Audit Fixture Bakery", "Classic", "12 inch"],
    ],
    headerRows: [0],
  }]);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("automatic workbook AI fallback browser audit");
});

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

test("manager gets Mauro's three products in review; source audit calls are read-only", async ({
  page,
  browserName,
}) => {
  test.setTimeout(60 * 60 * 1_000);
  const engine = browserName as BrowserName;
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInManager(page, true);
  const before = await masterDataCounts(page);
  const realParseResponse = engine === "chromium"
    ? page.waitForResponse(
      (response) =>
        response.url().includes("/api/ai/parse-spec-sheet") &&
        response.request().method() === "POST",
      { timeout: 8 * 60_000 },
    )
    : undefined;
  if (engine === "webkit") {
    await page.route("**/api/ai/parse-spec-sheet", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profiles: EXPECTED_MAURO_PRODUCTS.map((flavor) => ({
            brand: "Mauro's Pinsa",
            flavor,
            applicators: [],
            pepperonis: [],
          })),
          recipes: [],
          generatedAt: Date.now(),
        }),
      });
    });
  }
  const commitRequests: string[] = [];
  let mauroRequestCount = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/ai/parse-spec-sheet") &&
      request.method() === "POST"
    ) {
      mauroRequestCount++;
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /\/api\/(brand-profiles|dough-recipes|sauce-recipes|cheese-recipes|mixes)(?:\/|$)/.test(url.pathname)
    ) {
      commitRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await openWorkbookImport(page);
  await expect(page.getByTestId("spec-workbook-ai-disclosure")).toContainText(
    "authorized users automatically send extracted text",
  );
  const mauroPath = path.join(
    repoRoot,
    "attached_assets/0_Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1791920475343.xlsx",
  );
  await chooseWorkbook(page, mauroPath);
  const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(dialog.getByText("Step 1 of 2 — products.")).toBeVisible({
    timeout: 8 * 60_000,
  });
  let mauroParseSummary: Record<string, unknown> | null = null;
  let mauroHttpStatus: number | null = null;
  if (realParseResponse) {
    const response = await realParseResponse;
    mauroHttpStatus = response.status();
    expect(mauroHttpStatus, "The authorized real workbook parser must succeed before product review").toBe(200);
    if (response.ok()) {
      const parsed = await response.json() as ParsedSpecImport;
      mauroParseSummary = summarizeParse(
        parsed,
        sourceTextForBuffer(await readFile(mauroPath)),
      );
    }
  }

  // Labels now wrap to remain readable on short/narrow screens. Locate their
  // actual text rather than depending on the removed truncation CSS class.
  const visibleProducts: string[] = [];
  for (const flavor of EXPECTED_MAURO_PRODUCTS) {
    const label = dialog.getByText(`Mauro's Pinsa — ${flavor}`, { exact: true });
    await expect(label).toBeVisible();
    visibleProducts.push((await label.innerText()).trim());
  }
  const profileCount = await dialog.locator('li[data-testid^="spec-profile-"]').count();

  const viewportChecks: Array<Record<string, unknown>> = [];
  for (const viewport of [
    { label: "desktop", width: 1440, height: 900 },
    { label: "phone", width: 390, height: 844 },
    { label: "tablet-portrait", width: 768, height: 1024 },
    { label: "tablet-landscape", width: 1024, height: 768 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    const layout = await dialog.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    viewportChecks.push({ ...viewport, layout });
    if (viewport.label === "desktop") {
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: path.join(evidenceDir, `mauro-review-${engine}.png`),
        fullPage: false,
      });
    }
  }

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = await masterDataCounts(page);
  expect(after).toEqual(before);
  expect(commitRequests).toEqual([]);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, `browser-journey-${engine}.json`),
    `${JSON.stringify({
      format: "workbook-import-browser-journey",
      formatVersion: 1,
      engine,
      aiEvidence: engine === "chromium" ? "real-provider" : "mocked-provider",
      selectedSourceSha256: createHash("sha256").update(await readFile(mauroPath)).digest("hex"),
      visibleProducts,
      reviewReached: true,
      canceledWithoutApply: true,
      beforeMasterDataCounts: before.counts,
      beforeMasterDataSha256: before.snapshotSha256,
      afterMasterDataCounts: after.counts,
      afterMasterDataSha256: after.snapshotSha256,
      masterDataWriteRequests: commitRequests.length,
      viewportChecks,
      observedProductLabels: visibleProducts,
      parserRequestCount: mauroRequestCount,
      parserHttpStatus: mauroHttpStatus,
      realParseSummary: mauroParseSummary,
      viewportLimitations: "Browser emulation only; no physical Android/iOS device run.",
    }, null, 2)}\n`,
  );

  for (const flavor of EXPECTED_MAURO_PRODUCTS) {
    expect(visibleProducts).toContain(`Mauro's Pinsa — ${flavor}`);
  }
  expect(profileCount).toBeGreaterThanOrEqual(EXPECTED_MAURO_PRODUCTS.length);
  if (engine === "chromium") expect(mauroHttpStatus).toBe(200);

  if (engine !== "chromium") return;

  const manifest = JSON.parse(
    await readFile(path.join(evidenceDir, "manifest.json"), "utf8"),
  ) as {
    sha256?: string;
    files: Array<{
      path: string;
      sha256: string;
      importer: string;
      preparation?: Record<string, unknown>;
    }>;
  };
  const preparation = JSON.parse(
    await readFile(path.join(evidenceDir, "preparation.json"), "utf8"),
  ) as {
    importerRuns: Array<{
      sha256: string;
      importer: string;
      representativePath: string;
      status: string;
    }>;
  };
  const preparationBySource = new Map(
    preparation.importerRuns.map((entry) => [
      `${entry.sha256}\u0000${entry.importer}`,
      entry.status,
    ]),
  );
  manifest.files = manifest.files.map((file) => ({
    ...file,
    preparation: {
      ...(typeof file.preparation === "object" && file.preparation
        ? file.preparation as Record<string, unknown>
        : {}),
      status: preparationBySource.get(`${file.sha256}\u0000${file.importer}`) ?? "NOT_RUN",
    },
  }));
  await writeFile(
    path.join(evidenceDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const manifestSha256 = createHash("sha256")
    .update(await readFile(path.join(evidenceDir, "manifest.json")))
    .digest("hex");
  const unresolved = preparation.importerRuns.filter(
    (entry) => entry.status === "NEEDS_AI" || entry.status === "PARTIAL_NEEDS_AI",
  );
  const byHash = new Map<string, (typeof unresolved)[number]>();
  for (const entry of unresolved) {
    if (!byHash.has(entry.sha256)) byHash.set(entry.sha256, entry);
  }
  const mauroBytes = await readFile(mauroPath);
  const mauroHash = createHash("sha256").update(mauroBytes).digest("hex");
  const aiEntries: Array<Record<string, unknown>> = [];
  aiEntries.push({
    sha256: mauroHash,
    representativePath: path.relative(repoRoot, mauroPath),
    importer: "spec-import:pizza-spec",
    status: mauroParseSummary &&
      Number(mauroParseSummary.profileCount) >= EXPECTED_MAURO_PRODUCTS.length
      ? "AI_PARSED_REVIEW_REQUIRED"
      : mauroHttpStatus === 401 || mauroHttpStatus === 403
        ? "BLOCKED_AUTHORIZATION"
        : "AI_OUTPUT_REQUIRES_REVIEW",
    chunks: mauroRequestCount,
    output: mauroParseSummary,
    httpStatus: mauroHttpStatus,
    evidence: "real UI preparation request; user canceled before apply",
  });

  const paceTimes: number[] = Array.from(
    { length: mauroRequestCount },
    () => Date.now(),
  );
  const paceBeforeRequest = async () => {
    const now = Date.now();
    const cutoff = now - 62_000;
    while (paceTimes.length && paceTimes[0]! < cutoff) paceTimes.shift();
    if (paceTimes.length >= 8) {
      await page.waitForTimeout(Math.max(0, paceTimes[0]! + 62_100 - Date.now()));
    }
    paceTimes.push(Date.now());
  };

  let parseRequestCount = mauroRequestCount;
  let permissionBlocked = false;
  for (const entry of byHash.values()) {
    if (entry.sha256 === mauroHash) continue;
    const inputPath = path.join(repoRoot, entry.representativePath);
    const bytes = await readFile(inputPath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    expect(actualHash).toBe(entry.sha256);
    const grids = workbookGrids(bytes);
    const promptChunks = splitGridsForPrompt(grids);
    const sourceText = sourceTextForBuffer(bytes);
    const parsedChunks: ParsedSpecImport[] = [];
    const failureCodes: string[] = [];
    for (const chunk of promptChunks.chunks) {
      const workbookText = gridsToPromptText(chunk);
      let responseSummary: { status: number; parsed?: ParsedSpecImport } | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await paceBeforeRequest();
        parseRequestCount++;
        responseSummary = await page.evaluate(async ({ workbookText, clientId }) => {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 180_000);
          try {
            const response = await fetch("/api/ai/parse-spec-sheet", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-client-id": clientId,
              },
              body: JSON.stringify({ workbookText }),
              signal: controller.signal,
            });
            if (!response.ok) return { status: response.status };
            return {
              status: response.status,
              parsed: await response.json() as ParsedSpecImport,
            };
          } catch {
            return { status: controller.signal.aborted ? 504 : 502 };
          } finally {
            window.clearTimeout(timer);
          }
        }, {
          workbookText,
          clientId: `workbook-audit-${uniqueTestId("client")}`,
        });
        if (responseSummary.status === 200 && responseSummary.parsed) break;
        if (responseSummary.status === 429) {
          await page.waitForTimeout(65_000);
          continue;
        }
        failureCodes.push(
          responseSummary.status === 401 || responseSummary.status === 403
            ? `AUTH_${responseSummary.status}`
            : `HTTP_${responseSummary.status}`,
        );
        if (responseSummary.status === 401 || responseSummary.status === 403) {
          permissionBlocked = true;
        }
        break;
      }
      if (responseSummary?.status === 200 && responseSummary.parsed) {
        parsedChunks.push(responseSummary.parsed);
      } else if (!failureCodes.length) {
        failureCodes.push("RATE_LIMIT_RETRIES_EXHAUSTED");
      }
      if (permissionBlocked) break;
    }
    if (permissionBlocked) {
      aiEntries.push({
        sha256: entry.sha256,
        representativePath: entry.representativePath,
        importer: entry.importer,
        status: "BLOCKED_AUTHORIZATION",
        failureCodes,
      });
      break;
    }
    const merged = parsedChunks.length === 1
      ? parsedChunks[0]!
      : mergeParsedSpecImports(parsedChunks, { profileSlots: "union" });
    const summary = summarizeParse(merged, sourceText);
    const status = failureCodes.length
      ? "AI_PROVIDER_FAILURE"
      : summary.profileCount + summary.recipeCount === 0
        ? "AI_EMPTY"
        : summary.unresolvedCount > 0 ||
          summary.profileNamesNotFoundInSource > 0 ||
          summary.recipeNamesNotFoundInSource > 0 ||
          summary.ingredientNamesNotFoundInSource > 0 ||
          summary.numericWeightRowCount < summary.recipeRowCount ||
          summary.recipesMissingUnits > 0
          ? "AI_PARTIAL_REVIEW_REQUIRED"
          : "AI_PARSED_REVIEW_REQUIRED";
    if (status === "AI_EMPTY") failureCodes.push("AI_EMPTY_OUTPUT");
    const result = {
      sha256: entry.sha256,
      representativePath: entry.representativePath,
      importer: entry.importer,
      status,
      chunkCount: promptChunks.chunks.length,
      droppedRowCount: promptChunks.droppedRows,
      output: summary,
      failureCodes,
    };
    aiEntries.push(result);
  }

  const aiByHash = new Map(aiEntries.map((entry) => [String(entry.sha256), entry]));
  const matrixPath = path.join(evidenceDir, "matrix.json");
  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as {
    source: Record<string, unknown>;
    files: Array<Record<string, unknown> & { sha256?: string; realAiReview?: unknown }>;
    realAiAudit?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const auditedFiles = matrix.files.map((file) => ({
    ...file,
    realAiReview: aiByHash.get(String(file.sha256)) ?? file.realAiReview ?? null,
  }));
  const coverage = {
    format: "workbook-real-ai-audit",
    formatVersion: 1,
    source: {
      manifestSha256,
      filenameCount: manifest.files.length,
      distinctWorkbookContentCount: new Set(manifest.files.map((file) => file.sha256)).size,
      distinctAiContentCount: byHash.size,
      ratePacing: "maximum 8 parser requests per 62 seconds; 65-second wait on HTTP 429",
      applicationWrites: "none; only the read-only AI parse endpoint was called",
    },
    counts: {
      parserEndpointRequests: parseRequestCount,
      parserEndpointRequestSemantics:
        "Client-observed POSTs to /api/ai/parse-spec-sheet; provider-internal attempts are not observable here.",
      aiInputs: aiEntries.length,
      statuses: aiEntries.reduce<Record<string, number>>((counts, item) => {
        const status = String(item.status);
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {}),
    },
    entries: aiEntries,
    files: manifest.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      importer: file.importer,
      aiStatus: aiByHash.get(file.sha256)?.status ?? "NOT_REQUIRED",
    })),
  };
  await writeFile(
    path.join(evidenceDir, "ai-provider.json"),
    `${JSON.stringify(coverage, null, 2)}\n`,
  );
  matrix.files = auditedFiles;
  matrix.source.manifestSha256 = manifestSha256;
  matrix.realAiAudit = {
    ...(matrix.realAiAudit ?? {}),
    manifestSha256,
    distinctAiContentCount: byHash.size,
    parserEndpointRequests: parseRequestCount,
    completionStatus: permissionBlocked ? "BLOCKED" : "RECORDED",
  };
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  const ledgerPath = path.join(evidenceDir, "failure-ledger.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
    entries?: Array<Record<string, unknown> & { sha256?: string; status?: string }>;
    [key: string]: unknown;
  };
  ledger.entries = getWorkbookAuditFailureEntries(ledger).map((finding) => {
    if (finding.status !== "NEEDS_AI" && finding.status !== "PARTIAL_NEEDS_AI") {
      return finding;
    }
    const ai = aiByHash.get(String(finding.sha256));
    if (!ai) {
      return {
        ...finding,
        status: "AI_AUDIT_NOT_RUN",
        failureCode: "AI_NOT_RUN",
        nextAction: "Re-run the authorized real-AI audit for this source hash.",
      };
    }
    const status = String(ai.status);
    const completeEnough = status === "AI_PARSED_REVIEW_REQUIRED";
    const failureCodes = Array.isArray(ai.failureCodes)
      ? ai.failureCodes.filter((code): code is string => typeof code === "string")
      : [];
    return {
      ...finding,
      status,
      failureCode: completeEnough ? null : failureCodes[0] ?? status,
      nextAction: completeEnough
        ? "Manager review is still required; no workbook values were applied."
        : status === "AI_PROVIDER_FAILURE"
          ? `No parse result was available (${failureCodes.join(", ") || "provider failure"}). Do not auto-reparse; the manager may use the bounded Retry action after provider availability is restored.`
          : status === "AI_EMPTY"
            ? "The parser returned no usable products or recipes. Correct the source or use the bounded Retry action, then review before applying."
            : "Inspect source-backed fields in the review and resolve flagged gaps before any apply.",
    };
  });
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  const stagePath = path.join(evidenceDir, "stage-counts.json");
  const stages = JSON.parse(await readFile(stagePath, "utf8")) as Record<string, unknown>;
  await writeFile(stagePath, `${JSON.stringify({
    ...stages,
    aiParserEndpointRequests: parseRequestCount,
    aiDistinctInputs: aiEntries.length,
    aiParserAuditStatus: permissionBlocked ? "BLOCKED_AUTHORIZATION" : "COMPLETED",
  }, null, 2)}\n`);

  expect(permissionBlocked).toBe(false);
  expect(aiEntries).toHaveLength(byHash.size);
  expect(aiEntries.every((entry) =>
    entry.status === "AI_PARSED_REVIEW_REQUIRED" ||
    entry.status === "AI_PARTIAL_REVIEW_REQUIRED" ||
    entry.status === "AI_OUTPUT_REQUIRES_REVIEW" ||
    (entry.status === "AI_PROVIDER_FAILURE" &&
      Array.isArray(entry.failureCodes) && entry.failureCodes.length > 0) ||
    (entry.status === "AI_EMPTY" &&
      Array.isArray(entry.failureCodes) && entry.failureCodes.includes("AI_EMPTY_OUTPUT")),
  )).toBe(true);
});

test("deterministic exported workbook stays model-free", async ({ page, browserName }) => {
  await signInManager(page, true);
  const sourceBytes = deterministicExportBytes();
  let parserRequests = 0;
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    parserRequests++;
    await route.continue();
  });
  await openWorkbookImport(page);
  await page.getByTestId("spec-workbook-input").setInputFiles({
    name: "deterministic-export.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: sourceBytes,
  });
  const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(dialog.getByText("Step 1 of 2 — products.")).toBeVisible();
  await expect(dialog.getByText("Audit Fixture Bakery — Classic", { exact: true })).toBeVisible();
  expect(parserRequests).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await saveBrowserEvidence(`browser-deterministic-export-${browserName}.json`, {
    engine: browserName,
    modelRequests: parserRequests,
    completeDeterministicReviewReached: true,
    canceledBeforeApply: true,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  });
});

test("profile importer without AI permission sees guidance and sends no parse request", async ({
  page,
  browserName,
}) => {
  await signInManager(page, false);
  let parserRequests = 0;
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    parserRequests++;
    await route.continue();
  });
  await openWorkbookImport(page);
  const mauroPath = path.join(
    repoRoot,
    "attached_assets/0_Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1791920475343.xlsx",
  );
  await chooseWorkbook(page, mauroPath);
  const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(dialog.getByTestId("spec-import-unresolved")).toContainText(
    "AI interpretation is unavailable for your account",
  );
  expect(parserRequests).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await saveBrowserEvidence(`browser-no-ai-permission-${browserName}.json`, {
    engine: browserName,
    parserRequests,
    unresolvedGuidanceShown: true,
    canceledBeforeApply: true,
  });
});

test("provider failure preserves an incomplete review and one retry can recover", async ({
  page,
  browserName,
}) => {
  await signInManager(page, true);
  const before = await masterDataCounts(page);
  let parserRequests = 0;
  const mockStatusSequence: number[] = [];
  const commitRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      /\/api\/(brand-profiles|dough-recipes|sauce-recipes|cheese-recipes|mixes)(?:\/|$)/.test(url.pathname)
    ) {
      commitRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.route("**/api/ai/parse-spec-sheet", async (route) => {
    parserRequests++;
    if (parserRequests === 1) {
      mockStatusSequence.push(503);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Provider unavailable for this request." }),
      });
      return;
    }
    mockStatusSequence.push(200);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profiles: EXPECTED_MAURO_PRODUCTS.map((flavor) => ({
          brand: "Mauro's Pinsa",
          flavor,
          applicators: [],
          pepperonis: [],
        })),
        recipes: [],
        generatedAt: Date.now(),
      }),
    });
  });
  await openWorkbookImport(page);
  const mauroPath = path.join(
    repoRoot,
    "attached_assets/0_Mauro's_Pinsa_Pizza_Recipe_Specs_-_01_1791920475343.xlsx",
  );
  await chooseWorkbook(page, mauroPath);
  const dialog = page.getByRole("dialog", { name: "Import Spec Sheet" });
  await expect(dialog.getByTestId("spec-import-unresolved")).toBeVisible({
    timeout: 8 * 60_000,
  });
  await expect(dialog.getByTestId("spec-import-unresolved")).toContainText(
    "Automatic AI interpretation did not resolve all content",
  );
  await dialog.getByRole("button", { name: "Retry AI interpretation", exact: true }).click();
  for (const flavor of EXPECTED_MAURO_PRODUCTS) {
    await expect(dialog.getByText(new RegExp(`Mauro's Pinsa — ${flavor}`))).toBeVisible({
      timeout: 8 * 60_000,
    });
  }
  const citedCells = dialog.getByText("View cited cells").first();
  await expect(citedCells).toBeVisible();
  await citedCells.click();
  await expect(
    dialog.getByRole("button", { name: /Open .*OZ![A-Z]+\d+/ }).first(),
  ).toBeVisible();
  expect(parserRequests).toBe(2);
  const viewportChecks: Array<Record<string, unknown>> = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(new RegExp(`Mauro's Pinsa — ${EXPECTED_MAURO_PRODUCTS[0]}`)))
      .toBeVisible();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);
    viewportChecks.push({ ...viewport, documentWidth, status: "PASS" });
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const after = await masterDataCounts(page);
  expect(after.snapshot).toEqual(before.snapshot);
  expect(commitRequests).toEqual([]);
  await saveBrowserEvidence(`browser-provider-retry-${browserName}.json`, {
    engine: browserName,
    mockedStatusSequence: mockStatusSequence,
    incompleteReviewShownAfterProviderFailure: true,
    recoveryReviewReached: true,
    canceledBeforeApply: true,
    viewportChecks,
    beforeMasterDataCounts: before.counts,
    beforeMasterDataSha256: before.snapshotSha256,
    afterMasterDataCounts: after.counts,
    afterMasterDataSha256: after.snapshotSha256,
    masterDataUnchanged: true,
    masterDataWriteRequests: commitRequests.length,
  });
});
