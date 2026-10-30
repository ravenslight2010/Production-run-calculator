import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  fetchImportGoldLocal,
  isImportGoldDevelopmentRuntime,
  isImportGoldLocalAvailable,
  isImportGoldLocalConfigured,
} from "../lib/importGoldEndpoint";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  factoryKvTable,
  importHistoryTable,
  importOperationsTable,
  importGoldCasesTable,
  importGoldScoresTable,
  mixesTable,
  cheeseRecipesTable,
  doughRecipesTable,
  sauceRecipesTable,
  brandProfilesTable,
  freezerPullItemsTable,
  specImportAliasesTable,
  qcWorkflowEventsTable,
} from "@workspace/db";
import { buildImportQcSummary } from "../lib/importQcSummary";
import { IMPORT_SOURCE_RETENTION_MS } from "@workspace/db/schema";
import { currentScope } from "../lib/requestScope";
import {
  buildRecipeQcCapture,
  lockRecipeQcFamily,
  type RecipeQcFamily,
} from "../lib/recipeQcReview";
import { requireAnyCapability, requireCapability, requireLiveScope } from "../middlewares/requireCapability";
import { normalizeMix } from "@workspace/mixes";
import { normalizeCheeseRecipe } from "@workspace/cheese-recipes";
import { normalizeNamedRecipe } from "@workspace/named-recipes";
import { normalizeFreezerPullItem } from "@workspace/freezer-pull";
import { broadcastMasterDataChanged } from "./sync";
import { SPEC_IMPORT_PARSE_VERSION } from "@workspace/spec-import";
import { projectImportWrites, type ImportSnapshot, type ImportWriteSet } from "@workspace/spec-import/import-changes";
import { isGeminiProviderConfigured, openai, pickModel } from "@workspace/integrations-openai-ai-server";
import {
  writeAuditEvent,
  CHEESE_RECIPE_AUDIT_FIELDS,
  DOUGH_RECIPE_AUDIT_FIELDS,
  MIX_RECIPE_AUDIT_FIELDS,
  SAUCE_RECIPE_AUDIT_FIELDS,
} from "./auditLogs";

const router: IRouter = Router();
const MAX_ROWS = 500;
const MAX_BODY = 512 * 1024;
const MAX_SOURCE_EVIDENCE_BYTES = 100 * 1024;
const MAX_EXPORT_PAGE_SIZE = 20;
const MAX_GOLD_INPUT_BYTES = 100 * 1024;
const MAX_GOLD_EXPECTED_BYTES = 200 * 1024;
const MAX_GOLD_CASES = 100;
const MAX_GOLD_SCORE_CASES = 3;
const MAX_GOLD_DIFFS = 30;
const MAX_GOLD_DIFF_VALUE_CHARS = 400;
const GOLD_SOURCE_LABELS = { spec: "Spec import", premix: "Premix import", cheese: "Cheese import" } as const;
const LOCAL_GOLD_SCORING_SETTING = "importGoldLocalScoringEnabled";
const SYNTHETIC_GOLD_SOURCE_LABEL = "Synthetic local scoring fixture";
const SYNTHETIC_GOLD_OPERATION_ID = "dev-synthetic-local-score:v1";
const SYNTHETIC_GOLD_FIXTURE_VERSION = "synthetic-mix-v1";
const SYNTHETIC_GOLD_FIXTURE = {
  importType: "premix",
  input: {
    candidates: [{
      name: "Synthetic Sample Mix",
      brand: "Synthetic Brand",
      flavor: "Synthetic Flavor",
      batchSize: 4,
      components: [
        { ingredient: "Synthetic Flour", lbs: 2.5 },
        { ingredient: "Synthetic Water", lbs: 1.5 },
      ],
    }],
  },
  expectedResult: {
    mixes: [{
      name: "Synthetic Sample Mix",
      brand: "Synthetic Brand",
      flavor: "Synthetic Flavor",
      batchSize: 4,
      components: [
        { ingredient: "Synthetic Flour", lbs: 2.5 },
        { ingredient: "Synthetic Water", lbs: 1.5 },
      ],
    }],
  },
} as const;
const TABLES = {
  mixes: { table: mixesTable, key: "id" },
  cheeseRecipes: { table: cheeseRecipesTable, key: "id" },
  doughRecipes: { table: doughRecipesTable, key: "id" },
  sauceRecipes: { table: sauceRecipesTable, key: "id" },
  brandProfiles: { table: brandProfilesTable, key: "key" },
  freezerPullItems: { table: freezerPullItemsTable, key: "id" },
} as const;
type EntityName = keyof typeof TABLES;
type ChangeSet = Partial<Record<EntityName, { upsert?: unknown[]; delete?: string[] }>> & {
  specImportAliases?: { upsert?: unknown[]; delete?: unknown[] };
};

let failureHook: ((stage: string) => void) | undefined;
type GoldProviderName = "local" | "gemini";
type GoldProviderTestOverride = (
  provider: GoldProviderName,
  input: Record<string, unknown>,
  importType: string,
) => Promise<unknown>;
let goldProviderTestOverride: GoldProviderTestOverride | undefined;
/** Test-only failure injection. The hook is never configured by production code. */
export function setImportOperationFailureHookForTest(hook?: (stage: string) => void): void {
  failureHook = hook;
}
/** Test seam: automated tests must never call a real evaluator provider. */
export function setImportGoldProviderForTest(override?: GoldProviderTestOverride): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test provider unavailable");
  goldProviderTestOverride = override;
}
function fail(stage: string): void {
  failureHook?.(stage);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function objectBody(req: Request): Record<string, unknown> | null {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return null;
  if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) return null;
  return req.body as Record<string, unknown>;
}

function importGoldEnabled(): boolean {
  const rawApprovalRecordRef = process.env.IMPORT_GOLD_APPROVAL_RECORD_REF;
  const approvalRecordRef = rawApprovalRecordRef?.trim();
  const privacyReviewStatus = process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS?.trim();
  return process.env.IMPORT_GOLD_ENABLED === "true" &&
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED === "true" &&
    process.env.IMPORT_GOLD_RETENTION_APPROVED === "true" &&
    !!approvalRecordRef &&
    approvalRecordRef.length <= 500 &&
    !/[\u0000-\u001f\u007f]/u.test(rawApprovalRecordRef ?? "") &&
    (privacyReviewStatus === "approved" || privacyReviewStatus === "not_required");
}

function importGoldCleanupOnlyEnabled(): boolean {
  return process.env.IMPORT_GOLD_CLEANUP_ENABLED === "true" && !importGoldEnabled();
}

function rejectImportGoldContentDuringCleanup(res: Response): boolean {
  if (!importGoldCleanupOnlyEnabled()) return false;
  res.status(404).json({ error: "Import Gold content operations are unavailable during cleanup-only mode" });
  return true;
}

function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; }
}

function goldInputHasSafeJson(value: unknown, depth = 0, count = { nodes: 0 }): boolean {
  count.nodes++;
  if (count.nodes > 20_000 || depth > 24) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 10_000 && !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(value);
  if (Array.isArray(value)) return value.length <= MAX_ROWS && value.every((child) => goldInputHasSafeJson(child, depth + 1, count));
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 200 && entries.every(([key, child]) =>
    !["__proto__", "constructor", "prototype"].includes(key) &&
    !/(?:password|token|secret|credential|authorization|api[_-]?key|sourceText|filename|email)/iu.test(key) &&
    goldInputHasSafeJson(child, depth + 1, count),
  );
}

function validateGoldInput(value: unknown, importType: string): { input: Record<string, unknown> | null; error: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { input: null, error: "Invalid gold input" };
  const record = value as Record<string, unknown>;
  const expectedKeys = importType === "spec" ? ["profiles", "recipes"]
    : importType === "premix" ? ["candidates"] : ["recipes"];
  if (Object.keys(record).sort().join(",") !== expectedKeys.slice().sort().join(",")) {
    return { input: null, error: "Invalid gold input shape" };
  }
  const arrays = expectedKeys.map((key) => record[key]);
  if (arrays.some((array) => !Array.isArray(array) || array.length > MAX_ROWS)) {
    return { input: null, error: "Gold input has too many rows" };
  }
  if (!goldInputHasSafeJson(record)) return { input: null, error: "Gold input contains unsupported or sensitive data" };
  if (jsonBytes(record) > MAX_GOLD_INPUT_BYTES) return { input: null, error: "Gold input is too large" };
  return { input: jsonSafe(record), error: null };
}

function goldExpectedSnapshot(after: Record<string, unknown[]>, importType: string): Record<string, unknown[]> {
  const fields: Record<string, string[]> = {
    brandProfiles: ["key", "brand", "flavor", "values", "crustValues"],
    mixes: ["name", "brand", "flavor", "batchSize", "daysEarly", "notes", "amountAlreadyMade", "components", "isPrep", "enabled"],
    cheeseRecipes: ["name", "brand", "flavors", "shredderSetting", "cellulose", "notes", "components", "enabled"],
    doughRecipes: ["name", "notes", "components", "enabled", "isPremadeCrust", "brand", "flavors", "doughballWeightOz", "doughballsPerTray", "doughballVariants"],
    sauceRecipes: ["name", "notes", "components", "enabled", "brand", "flavors"],
    freezerPullItems: ["ingredient", "freezerDaysEarly", "enabled"],
  };
  const allowed = importType === "spec"
    ? ["brandProfiles", "mixes", "cheeseRecipes", "doughRecipes", "sauceRecipes"]
    : importType === "premix" ? ["mixes", "freezerPullItems"] : ["cheeseRecipes"];
  return Object.fromEntries(allowed.map((key) => [
    key,
    (after[key] ?? []).map((row) => Object.fromEntries(
      fields[key]!.filter((field) => field in (row as Record<string, unknown>))
        .map((field) => [field, (row as Record<string, unknown>)[field]]),
    )),
  ]));
}

function flattenFields(value: unknown, prefix = "", result: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) result.set(prefix, {});
    for (const [key, child] of entries) flattenFields(child, prefix ? `${prefix}.${key}` : key, result);
  } else if (Array.isArray(value)) {
    if (value.length === 0 && prefix) result.set(prefix, []);
    value.forEach((child, index) => flattenFields(child, `${prefix}[${index}]`, result));
  } else if (prefix) {
    result.set(prefix, value);
  }
  return result;
}

export function compareImportGoldFields(expected: unknown, predicted: unknown): {
  comparedFields: number;
  equalFields: number;
  accuracy: number;
  fieldDiffs: Array<{ field: string; expected: unknown; predicted: unknown }>;
} {
  const expectedFields = flattenFields(expected);
  const predictedFields = flattenFields(predicted);
  const keys = [...new Set([...expectedFields.keys(), ...predictedFields.keys()])].sort();
  let equalFields = 0;
  const fieldDiffs: Array<{ field: string; expected: unknown; predicted: unknown }> = [];
  for (const field of keys) {
    const hasExpected = expectedFields.has(field);
    const hasPredicted = predictedFields.has(field);
    const left = expectedFields.get(field);
    const right = predictedFields.get(field);
    if (hasExpected && hasPredicted && isDeepStrictEqual(left, right)) equalFields++;
    else if (fieldDiffs.length < MAX_GOLD_DIFFS) {
      fieldDiffs.push({
        field,
        expected: hasExpected ? safeDiffValue(left) : null,
        predicted: hasPredicted ? safeDiffValue(right) : null,
      });
    }
  }
  return {
    comparedFields: keys.length,
    equalFields,
    accuracy: keys.length ? Math.round((equalFields / keys.length) * 10000) / 100 : 100,
    fieldDiffs,
  };
}

function safeDiffValue(value: unknown): unknown {
  return typeof value === "string" && value.length > MAX_GOLD_DIFF_VALUE_CHARS
    ? `${value.slice(0, MAX_GOLD_DIFF_VALUE_CHARS)}…`
    : value;
}

function parseGoldPrediction(content: unknown, allowSingleObjectWrapper = false): Record<string, unknown> {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_GOLD_EXPECTED_BYTES) {
    throw new Error("invalid_output");
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    if (!allowSingleObjectWrapper) throw new Error("invalid_output");
    // The pinned local model can return one valid object inside a reasoning
    // wrapper even with server-side reasoning disabled. Never guess between
    // multiple objects; Gemini keeps the strict whole-response JSON contract.
    const objectCandidates: string[] = [];
    let depth = 0;
    let objectStart = -1;
    let inString = false;
    let escaped = false;
    let malformedBraces = false;
    for (let index = 0; index < content.length; index += 1) {
      const character = content.charAt(index);
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        if (depth === 0) objectStart = index;
        depth += 1;
      } else if (character === "}") {
        if (depth === 0) {
          malformedBraces = true;
          continue;
        }
        depth -= 1;
        if (depth === 0 && objectStart >= 0) {
          objectCandidates.push(content.slice(objectStart, index + 1));
          objectStart = -1;
        }
      }
    }
    if (malformedBraces || depth !== 0 || objectCandidates.length !== 1) {
      throw new Error("invalid_output");
    }
    try { value = JSON.parse(objectCandidates[0]!); } catch { throw new Error("invalid_output"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || jsonBytes(value) > MAX_GOLD_EXPECTED_BYTES) {
    throw new Error("invalid_output");
  }
  return value as Record<string, unknown>;
}

function isPredictionShapeValid(actual: unknown, expectedShape: unknown, depth = 0): boolean {
  if (depth > 24) return false;
  if (Array.isArray(expectedShape)) {
    return Array.isArray(actual) && actual.length <= MAX_ROWS &&
      (expectedShape.length === 0
        ? goldInputHasSafeJson(actual, depth + 1)
        : actual.every((child) => isPredictionShapeValid(child, expectedShape[0], depth + 1)));
  }
  if (expectedShape && typeof expectedShape === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const expected = expectedShape as Record<string, unknown>;
    const candidate = actual as Record<string, unknown>;
    return Object.keys(candidate).every((key) => key in expected) &&
      Object.entries(candidate).every(([key, child]) => isPredictionShapeValid(child, expected[key], depth + 1));
  }
  if (expectedShape === null) return actual === null;
  return typeof actual === typeof expectedShape;
}

function validateGoldPrediction(value: unknown, expected: Record<string, unknown>): Record<string, unknown> {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    jsonBytes(value) > MAX_GOLD_EXPECTED_BYTES ||
    !goldInputHasSafeJson(value) ||
    !isPredictionShapeValid(value, expected)
  ) throw new Error("invalid_output");
  return value as Record<string, unknown>;
}

function outputShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [outputShape(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, outputShape(child)]));
  }
  if (typeof value === "string") return "<string>";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  return null;
}

async function requestLocalGoldPrediction(input: Record<string, unknown>, importType: string, expected: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = process.env.IMPORT_GOLD_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1";
  const response = await fetchImportGoldLocal(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "qwen3.5-9b-q3_k_m",
      messages: [
        { role: "system", content: `Score-only import evaluator. Extract a ${importType} import result from evaluatedInput. Return exactly one JSON object matching the keys and value types in expectedShape; do not copy placeholder values. No reasoning tags, prose, Markdown, tools, or extra keys.` },
        { role: "user", content: JSON.stringify({ evaluatedInput: input, expectedShape: outputShape(expected) }) },
      ],
      temperature: 0,
      max_tokens: 256,
      stream: false,
    }),
    signal: AbortSignal.timeout(175_000),
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  return parseGoldPrediction(body.choices?.[0]?.message?.content, true);
}

async function requestGeminiGoldPrediction(input: Record<string, unknown>, importType: string, expected: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isGeminiProviderConfigured()) throw new Error("provider_not_configured");
  const response = await openai.chat.completions.create({
    model: pickModel("cheap"),
    messages: [
      { role: "system", content: `Score-only import evaluator. Extract a ${importType} import result from evaluatedInput. Return JSON matching the keys and value types in expectedShape; do not copy placeholder values. No prose, tools, or extra keys.` },
      { role: "user", content: JSON.stringify({ evaluatedInput: input, expectedShape: outputShape(expected) }) },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 256,
  });
  return parseGoldPrediction(response.choices[0]?.message?.content);
}
function validateSourceEvidence(
  value: unknown,
  importType: string,
  scope: string,
  capabilities: readonly string[],
  actorId: string | undefined,
): { evidence: Record<string, unknown> | null; error: string | null } {
  if (value === undefined) return { evidence: null, error: null };
  if (importType !== "spec" || scope !== "live" || !capabilities.includes("manage-profiles") || !actorId) {
    return { evidence: null, error: "Source evidence is only accepted for authorized live spec imports" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { evidence: null, error: "Invalid source evidence" };
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "parseVersion,sourceText" ||
    typeof candidate.sourceText !== "string" ||
    !candidate.sourceText.trim() ||
    Buffer.byteLength(candidate.sourceText, "utf8") > MAX_SOURCE_EVIDENCE_BYTES ||
    candidate.parseVersion !== SPEC_IMPORT_PARSE_VERSION
  ) {
    return { evidence: null, error: "Invalid source evidence" };
  }
  return {
    evidence: {
      format: "spec-apply-source-v1",
      sourceText: candidate.sourceText,
      sourceSha256: createHash("sha256").update(candidate.sourceText).digest("hex"),
      parseVersion: SPEC_IMPORT_PARSE_VERSION,
      actorCapability: "manage-profiles",
      actorIdSha256: createHash("sha256").update(actorId).digest("hex"),
    },
    error: null,
  };
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).filter((row): row is Record<string, unknown> =>
    !!row && typeof row === "object" && !Array.isArray(row));
}
function validateChangeLimits(changes: ChangeSet): string | null {
  for (const [name, change] of Object.entries(changes)) {
    if (!change || typeof change !== "object") continue;
    const upsert = Array.isArray((change as any).upsert) ? (change as any).upsert : [];
    const deleted = Array.isArray((change as any).delete) ? (change as any).delete : [];
    if (upsert.length > MAX_ROWS || deleted.length > MAX_ROWS) return `Too many ${name} changes`;
  }
  return null;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).map((v) => String(v ?? "").trim()).filter(Boolean);
}
function capability(importType: string): "manage-profiles" | "manage-inventory" {
  return ["premix", "cheese"].includes(importType) ? "manage-inventory" : "manage-profiles";
}
function requestCorrelationId(req: Request): string {
  const candidate = (req as Request & { correlationId?: unknown }).correlationId;
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 128
    ? candidate
    : randomUUID();
}
function entityCapability(entity: string): "manage-profiles" | "manage-inventory" {
  return ["mixes", "cheeseRecipes"].includes(entity) ? "manage-inventory" : "manage-profiles";
}
function snapshotCapabilities(snapshot: Record<string, unknown[]>): Set<"manage-profiles" | "manage-inventory"> {
  return new Set(Object.keys(snapshot).filter((key) => key !== "specImportAliasKeys").map(entityCapability));
}
function requireOperationCapability(req: Request, res: Response, importType: string): boolean {
  const needed = capability(importType);
  if (!(req.capabilities ?? []).includes(needed)) {
    res.status(403).json({ error: `Missing capability: ${needed}` });
    return false;
  }
  return true;
}
function aliasKey(value: unknown): { kind: string; externalName: string; context: string | null } | null {
  if (typeof value === "string") {
    const [kind, externalName, context = ""] = value.split("\u0000");
    return kind && externalName ? { kind, externalName, context: context || null } : null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = String(row.kind ?? "").trim();
  const externalName = String(row.externalName ?? "").trim();
  if (!kind || !externalName) return null;
  return { kind, externalName, context: row.context == null ? null : String(row.context).trim() || null };
}
function aliasChanges(change: ChangeSet["specImportAliases"]): Array<{ kind: string; externalName: string; context: string | null }> {
  return [
    ...rows(change?.upsert).map(aliasKey),
    ...(Array.isArray(change?.delete) ? change!.delete!.slice(0, MAX_ROWS).map(aliasKey) : []),
  ].filter((entry): entry is { kind: string; externalName: string; context: string | null } => !!entry);
}

async function capture(tx: any, changes: ChangeSet, scope: string): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const change = changes[name];
    if (!change) continue;
    const keys = [...new Set([
      ...rows(change.upsert).map((r) => String(r[config.key] ?? "")),
      ...ids(change.delete),
    ].filter(Boolean))];
    if (!keys.length) continue;
    const column = (config.table as any)[config.key];
    result[name] = jsonSafe(await tx.select().from(config.table)
      .where(and(eq((config.table as any).scope, scope), inArray(column, keys))));
  }
  if (changes.specImportAliases) {
    const keys = aliasChanges(changes.specImportAliases);
    result.specImportAliasKeys = keys as unknown[];
    const predicates = keys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    result.specImportAliases = predicates.length
      ? jsonSafe(await tx.select().from(specImportAliasesTable).where(and(eq(specImportAliasesTable.scope, scope), or(...predicates))))
      : [];
  }
  return result;
}

async function captureSnapshotRows(
  tx: any,
  snapshot: Record<string, unknown[]>,
  scope: string,
  identitySnapshot: Record<string, unknown[]> = snapshot,
): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const saved = snapshot[name] ?? [];
    const keys = [...new Set([
      ...saved.map((row: any) => String(row[config.key])),
      ...(identitySnapshot[name] ?? []).map((row: any) => String(row[config.key])),
    ].filter(Boolean))];
    if (!keys.length) continue;
    result[name] = jsonSafe(await tx.select().from(config.table).where(and(
      eq((config.table as any).scope, scope),
      inArray((config.table as any)[config.key], keys),
    )));
  }
  if (
    snapshot.specImportAliasKeys || snapshot.specImportAliases ||
    identitySnapshot.specImportAliasKeys || identitySnapshot.specImportAliases
  ) {
    const keys = [
      ...(snapshot.specImportAliasKeys ?? snapshot.specImportAliases ?? []),
      ...(identitySnapshot.specImportAliasKeys ?? identitySnapshot.specImportAliases ?? []),
    ]
      .map((row: any) => aliasKey(row)).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    const uniqueKeys = [...new Map(keys.map((key) => [
      `${key.kind}\u0000${key.externalName}\u0000${key.context ?? ""}`,
      key,
    ])).values()];
    result.specImportAliasKeys = uniqueKeys as unknown[];
    const predicates = uniqueKeys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    result.specImportAliases = predicates.length
      ? jsonSafe(await tx.select().from(specImportAliasesTable).where(and(eq(specImportAliasesTable.scope, scope), or(...predicates))))
      : [];
  }
  return result;
}

const RECIPE_AUDIT_CONFIG = {
  cheeseRecipes: { family: "cheese_recipe", fields: CHEESE_RECIPE_AUDIT_FIELDS },
  doughRecipes: { family: "dough_recipe", fields: DOUGH_RECIPE_AUDIT_FIELDS },
  sauceRecipes: { family: "sauce_recipe", fields: SAUCE_RECIPE_AUDIT_FIELDS },
  mixes: { family: "mix_recipe", fields: MIX_RECIPE_AUDIT_FIELDS },
} as const;

async function auditImportedRecipeChanges(
  tx: any,
  before: Record<string, unknown[]>,
  after: Record<string, unknown[]>,
  correlationId: string,
): Promise<void> {
  for (const [entity, config] of Object.entries(RECIPE_AUDIT_CONFIG) as [
    keyof typeof RECIPE_AUDIT_CONFIG,
    (typeof RECIPE_AUDIT_CONFIG)[keyof typeof RECIPE_AUDIT_CONFIG],
  ][]) {
    const beforeById = new Map((before[entity] ?? []).map((row: any) => [String(row.id), row]));
    const afterById = new Map((after[entity] ?? []).map((row: any) => [String(row.id), row]));
    const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

    for (const id of ids) {
      const prior = beforeById.get(id) as Record<string, unknown> | undefined;
      const current = afterById.get(id) as Record<string, unknown> | undefined;
      let action: string;
      let fieldNames: readonly string[];

      if (!prior && current) {
        action = `${config.family}_created`;
        fieldNames = config.fields;
      } else if (prior && !current) {
        action = `${config.family}_deleted`;
        fieldNames = config.fields;
      } else if (prior && current) {
        const changedFields = config.fields.filter((field) =>
          !isDeepStrictEqual(prior[field], current[field]));
        if (changedFields.length === 0) continue;
        action = `${config.family}_updated`;
        fieldNames = changedFields;
      } else {
        continue;
      }

      await writeAuditEvent(tx, {
        action,
        resource: `${config.family}:${id}`,
        changes: { fieldNames, correlationId },
      });
    }
  }
}

function normalizeImportRow(name: string, raw: Record<string, unknown>): Record<string, unknown> {
  const normalized = name === "mixes" ? normalizeMix(raw)
    : name === "cheeseRecipes" ? normalizeCheeseRecipe(raw)
      : name === "freezerPullItems" ? normalizeFreezerPullItem(raw)
        : name === "doughRecipes" || name === "sauceRecipes" ? normalizeNamedRecipe(raw)
          : raw;
  if (!normalized || typeof normalized !== "object") throw new Error(`Invalid ${name} entity`);
  return normalized as Record<string, unknown>;
}

async function captureImportedRecipeReviews(
  tx: any,
  before: Record<string, unknown[]>,
  after: Record<string, unknown[]>,
  scope: string,
  actorId: string,
): Promise<number> {
  const entities = [
    ["doughRecipes", "dough"] as const,
    ["sauceRecipes", "sauce"] as const,
    ["cheeseRecipes", "cheese"] as const,
    ["mixes", "mix"] as const,
  ] satisfies readonly [string, RecipeQcFamily][];
  let count = 0;
  for (const [entity, family] of entities) {
    const beforeById = new Map((before[entity] ?? []).map((row: any) => [String(row.id), row]));
    for (const raw of after[entity] ?? []) {
      const current = normalizeImportRow(entity, raw as Record<string, unknown>);
      const id = String(current.id ?? "");
      if (!id) continue;
      const previousRaw = beforeById.get(id) as Record<string, unknown> | undefined;
      const previous = previousRaw ? normalizeImportRow(entity, previousRaw) : undefined;
      const capture = buildRecipeQcCapture(family, id, previous, current);
      if (!capture) continue;
      await tx.insert(qcWorkflowEventsTable).values({
        scope,
        operationId: capture.operationId,
        recordId: capture.recordId,
        eventType: "recipe-committed",
        actorId,
        payload: capture.payload,
      });
      count += 1;
    }
  }
  return count;
}

async function applyRows(tx: any, changes: ChangeSet, scope: string): Promise<void> {
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const change = changes[name];
    if (!change) continue;
    const table: any = config.table;
    const keyColumn = table[config.key];
    const existing = await tx.select().from(table).where(eq(table.scope, scope)).for("update");
    const existingByKey = new Map<string, any>(existing.map((row: any) => [String(row[config.key]), row]));
    for (const raw of rows(change.upsert)) {
      const normalized = normalizeImportRow(name, raw);
      if (!normalized || typeof normalized !== "object") throw new Error(`Invalid ${name} entity`);
      const key = String((normalized as Record<string, unknown>)[config.key] ?? "").trim();
      if (!key || key.length > 300) throw new Error(`Invalid ${name} identity`);
      const prior = existingByKey.get(key);
      const forceProfile = name === "brandProfiles" && raw.force === true;
      if (prior && (normalized as any).updatedAt != null) {
        const incoming = new Date(String((normalized as any).updatedAt)).getTime();
        if (!Number.isFinite(incoming) || incoming < new Date(prior.updatedAt).getTime()) {
          const error = new Error(`Stale ${name} revision`);
          (error as any).code = "STALE_IMPORT";
          throw error;
        }
      }
      if (
        prior && !forceProfile &&
        (normalized as any).updatedAtMs != null &&
        Number((normalized as any).updatedAtMs) < Number(prior.updatedAtMs)
      ) {
        const error = new Error(`Stale ${name} revision`);
        (error as any).code = "STALE_IMPORT";
        throw error;
      }
      const values: Record<string, unknown> = { ...(normalized as Record<string, unknown>), scope };
      delete values.createdAt;
      delete values.updatedAt;
      delete values.force;
      // Database timestamps are server-owned; this also prevents a reviewed
      // payload from moving a revision backwards.
      if ("updatedAt" in table) values.updatedAt = new Date();
      if ("updatedAtMs" in table && raw.updatedAtMs != null) {
        const incomingStamp = Number(raw.updatedAtMs);
        values.updatedAtMs = forceProfile && prior
          ? Math.max(Number(prior.updatedAtMs) + 1, incomingStamp)
          : incomingStamp;
      }
      const insert = tx.insert(table).values(values);
      const set: Record<string, unknown> = { ...values };
      delete set[config.key];
      delete set.scope;
      delete set.createdAt;
      await insert.onConflictDoUpdate({ target: [keyColumn, table.scope], set });
    }
    const deleted = ids(change.delete);
    if (deleted.length) await tx.delete(table).where(and(eq(table.scope, scope), inArray(keyColumn, deleted)));
    fail(`after-${name}`);
  }
  const aliases = changes.specImportAliases;
  if (aliases) {
    for (const raw of rows(aliases.upsert)) {
      const kind = String(raw.kind ?? "").trim();
      const externalName = String(raw.externalName ?? "").trim().slice(0, 200);
      const canonicalName = String(raw.canonicalName ?? "").trim().slice(0, 200);
      if (!kind || !externalName || !canonicalName) throw new Error("Invalid spec alias");
      const context = raw.context == null ? null : String(raw.context).trim().slice(0, 200) || null;
      const existing = await tx.select().from(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        eq(specImportAliasesTable.kind, kind),
        eq(specImportAliasesTable.externalName, externalName),
        context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, context),
      )).limit(1);
      if (existing[0]) {
        await tx.update(specImportAliasesTable).set({ canonicalName, updatedAt: new Date() })
          .where(eq(specImportAliasesTable.id, existing[0].id));
      } else {
        await tx.insert(specImportAliasesTable).values({ scope, kind, externalName, canonicalName, context });
      }
    }
    const deleteKeys = (Array.isArray(aliases.delete) ? aliases.delete : [])
      .slice(0, MAX_ROWS).map(aliasKey).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    for (const key of deleteKeys) {
      await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        eq(specImportAliasesTable.kind, key.kind),
        eq(specImportAliasesTable.externalName, key.externalName),
        key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
      ));
    }
    fail("after-specImportAliases");
  }
}

async function restore(tx: any, snapshot: Record<string, unknown[]>, after: Record<string, unknown[]>, scope: string): Promise<void> {
  for (const [name, config] of Object.entries(TABLES) as [EntityName, typeof TABLES[EntityName]][]) {
    const saved = snapshot[name] ?? [];
    const table: any = config.table;
    const keys = [...new Set([
      ...saved.map((row: any) => String(row[config.key])),
      ...(after[name] ?? []).map((row: any) => String(row[config.key])),
    ])];
    if (keys.length) await tx.delete(table).where(and(eq(table.scope, scope), inArray(table[config.key], keys)));
    for (const row of saved) {
      const value: Record<string, unknown> = { ...(row as Record<string, unknown>), scope };
      if (typeof value.createdAt === "string") value.createdAt = new Date(value.createdAt);
      if (typeof value.updatedAt === "string") value.updatedAt = new Date(value.updatedAt);
      await tx.insert(table).values(value);
    }
  }
  if (snapshot.specImportAliasKeys || snapshot.specImportAliases || after.specImportAliasKeys || after.specImportAliases) {
    const keys = [
      ...(snapshot.specImportAliasKeys ?? snapshot.specImportAliases ?? []),
      ...(after.specImportAliasKeys ?? after.specImportAliases ?? []),
    ].map((row: any) => aliasKey(row)).filter(Boolean) as Array<{ kind: string; externalName: string; context: string | null }>;
    const predicates = keys.map((key) => and(
      eq(specImportAliasesTable.kind, key.kind),
      eq(specImportAliasesTable.externalName, key.externalName),
      key.context === null ? sql`${specImportAliasesTable.context} IS NULL` : eq(specImportAliasesTable.context, key.context),
    ));
    if (predicates.length) {
      await tx.delete(specImportAliasesTable).where(and(
        eq(specImportAliasesTable.scope, scope),
        or(...predicates),
      ));
    }
    for (const row of snapshot.specImportAliases ?? []) {
      const value: Record<string, unknown> = { ...(row as Record<string, unknown>), scope };
      delete value.id;
      if (typeof value.createdAt === "string") value.createdAt = new Date(value.createdAt);
      if (typeof value.updatedAt === "string") value.updatedAt = new Date(value.updatedAt);
      await tx.insert(specImportAliasesTable).values(value);
    }
  }
}

function operationApi(row: any) {
  return {
    operationId: row.id, importType: row.importType, sourceKey: row.sourceKey,
    sourceLabel: row.sourceLabel, status: row.status, requestHash: row.requestHash,
    resultHash: row.resultHash, affectedEntities: row.affectedEntities,
    result: row.result, createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(), undoneAt: row.undoneAt?.getTime() ?? null,
  };
}

// Reads exactly the affected rows. No alias learning, repair, write or stock path.
router.post("/import-operations/preview", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req, res) => {
  const body = objectBody(req);
  const importType = String(body?.importType ?? "");
  const changes = body?.changes as ChangeSet | undefined;
  if (!body || !["spec", "premix", "cheese"].includes(importType) || !changes || Array.isArray(changes) || typeof changes !== "object") {
    res.status(400).json({ error: "Invalid import review request" }); return;
  }
  const allowed = new Set([...Object.keys(TABLES), "specImportAliases"]);
  if (Object.keys(changes).some((key) => !allowed.has(key))) {
    res.status(400).json({ error: "Unsupported import entity" }); return;
  }
  const limitError = validateChangeLimits(changes);
  if (limitError) { res.status(400).json({ error: limitError }); return; }
  if (!requireOperationCapability(req, res, importType)) return;
  for (const entity of Object.keys(changes)) {
    if (!(req.capabilities ?? []).includes(entityCapability(entity))) {
      res.status(403).json({ error: "Missing import entity capability" }); return;
    }
  }
  if (body.sourceKey != null && (typeof body.sourceKey !== "string" || body.sourceKey.length > 300)) {
    res.status(400).json({ error: "Invalid source identity" }); return;
  }
  const scope = currentScope();
  const writes: ImportWriteSet = {};
  for (const [entity, change] of Object.entries(changes)) {
    writes[entity] = {
      upsert: rows(change.upsert).map((row) => {
        if (entity !== "specImportAliases") return normalizeImportRow(entity, row);
        return {
          kind: String(row.kind ?? "").trim(),
          externalName: String(row.externalName ?? "").trim().slice(0, 200),
          canonicalName: String(row.canonicalName ?? "").trim().slice(0, 200),
          context: row.context == null ? null : String(row.context).trim().slice(0, 200) || null,
        };
      }),
      delete: entity === "specImportAliases"
        ? (change.delete ?? []).map(aliasKey).filter((key) => key !== null)
        : change.delete ?? [],
    };
  }
  const before = await capture(db, changes, scope) as ImportSnapshot;
  const after = projectImportWrites(before, writes);
  const prior = body.sourceKey ? await db.select({
    id: importOperationsTable.id,
    createdAt: importOperationsTable.createdAt,
    after: importOperationsTable.afterSnapshot,
  }).from(importOperationsTable).where(and(
    eq(importOperationsTable.scope, scope),
    eq(importOperationsTable.importType, importType),
    eq(importOperationsTable.sourceKey, body.sourceKey),
    eq(importOperationsTable.status, "applied"),
  )).orderBy(desc(importOperationsTable.createdAt), desc(importOperationsTable.id)).limit(1) : [];
  const baseline = prior[0];
  res.json({
    expectedStateHash: hash(before), before, after,
    baseline: baseline ? {
      status: "available",
      operationId: baseline.id,
      appliedAt: baseline.createdAt.getTime(),
      before: Object.fromEntries(Object.keys(writes).map((entity) => [entity, (baseline.after as ImportSnapshot)[entity] ?? []])),
      after: Object.fromEntries(Object.entries(writes).map(([entity, change]) => [entity, change.upsert ?? []])),
      limitation: "Previous successful Apply landed values, not raw source. Only currently authorized reviewed entity types are compared. Prior-only rows indicate source coverage changes, not deletion instructions. Fields absent from a candidate are unknown, not instructions to clear current factory fields.",
    } : {
      status: "unavailable",
      limitation: body.sourceKey
        ? "No retained successful, non-undone Apply for this scoped source. Legacy review snapshots are not successful Apply evidence."
        : "This import has no recognized source identity.",
    },
  });
});

router.post("/import-operations/:operationId/apply", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req: Request, res: Response) => {
  const body = objectBody(req);
  const operationId = String(req.params.operationId ?? "").trim();
  if (!body || !/^[A-Za-z0-9_-]{16,120}$/.test(operationId)) {
    res.status(400).json({ error: "Invalid import operation request" }); return;
  }
  const importType = String(body.importType ?? "").trim();
  if (!importType || !body.changes || typeof body.changes !== "object") {
    res.status(400).json({ error: "Invalid import operation request" }); return;
  }
  const changes = body.changes as ChangeSet;
  const allowed = new Set(Object.keys(TABLES).concat("specImportAliases"));
  if (Object.keys(changes).some((key) => !allowed.has(key))) {
    res.status(400).json({ error: "Unsupported import entity" }); return;
  }
  const limitError = validateChangeLimits(changes);
  if (limitError) { res.status(400).json({ error: limitError }); return; }
  const requestHash = hash({ ...body, requestHash: undefined });
  const expectedRequestHash = body.requestHash == null ? null : String(body.requestHash);
  if (expectedRequestHash && expectedRequestHash !== requestHash) {
    res.status(409).json({ error: "IMPORT_REQUEST_CHANGED" }); return;
  }
  const scope = currentScope();
  const required = capability(importType);
  const capabilities = req.capabilities ?? [];
   if (!capabilities.includes(required)) {
     res.status(403).json({ error: `Missing capability: ${required}` }); return;
   }
   for (const entity of Object.keys(changes)) {
     const needed = entityCapability(entity);
     if (!capabilities.includes(needed)) {
       res.status(403).json({ error: `Missing capability: ${needed}` }); return;
     }
   }
  const sourceEvidence = validateSourceEvidence(
    body.sourceEvidence,
    importType,
    scope,
    capabilities,
    req.userId,
  );
  if (sourceEvidence.error) {
    res.status(400).json({ error: sourceEvidence.error });
    return;
  }
  let goldInput: Record<string, unknown> | null = null;
  if (body.goldCapture !== undefined) {
    const capture = body.goldCapture as Record<string, unknown> | null;
    if (
      !importGoldEnabled() ||
      !capabilities.includes("manage-staff") ||
      !["spec", "premix", "cheese"].includes(importType) ||
      !capture || typeof capture !== "object" || Array.isArray(capture) ||
      Object.keys(capture).sort().join(",") !== "input"
    ) {
      res.status(importGoldEnabled() ? 403 : 404).json({ error: "Import gold capture is unavailable" });
      return;
    }
    const validated = validateGoldInput(capture.input, importType);
    if (validated.error || !validated.input) {
      res.status(400).json({ error: validated.error ?? "Invalid gold input" });
      return;
    }
    goldInput = validated.input;
  }
  try {
    const operation = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + scope}, 0))`);
      const prior = await tx.select().from(importOperationsTable).where(and(
        eq(importOperationsTable.id, operationId), eq(importOperationsTable.scope, scope),
      )).limit(1);
      if (prior[0]) {
        if (prior[0].requestHash !== requestHash) {
          const error = new Error("IMPORT_REQUEST_CHANGED"); (error as any).code = "REQUEST_CHANGED"; throw error;
        }
        return prior[0];
      }
      const familyByEntity: Record<string, RecipeQcFamily> = {
        doughRecipes: "dough",
        sauceRecipes: "sauce",
        cheeseRecipes: "cheese",
        mixes: "mix",
      };
      const families = [...new Set(
        Object.keys(changes)
          .map((entity) => familyByEntity[entity])
          .filter((family): family is RecipeQcFamily => family !== undefined),
      )].sort();
      for (const family of families) await lockRecipeQcFamily(tx, scope, family);
      const before = await capture(tx, changes, scope);
      fail("after-before-snapshot");
      const beforeHash = hash(before);
      if (body.expectedStateHash && String(body.expectedStateHash) !== beforeHash) {
        const error = new Error("STALE_REVIEWED_STATE"); (error as any).code = "STALE_REVIEW"; throw error;
      }
      await applyRows(tx, changes, scope);
      fail("after-domain-writes");
      const after = await capture(tx, changes, scope);
      const recipeQcChangedCount = await captureImportedRecipeReviews(
        tx,
        before as Record<string, unknown[]>,
        after as Record<string, unknown[]>,
        scope,
        req.userId!,
      );
      fail("after-recipe-qc-capture");
      const expectedResult = goldInput ? goldExpectedSnapshot(after, importType) : null;
      if (expectedResult && jsonBytes(expectedResult) > MAX_GOLD_EXPECTED_BYTES) {
        const error = new Error("IMPORT_GOLD_EXPECTED_TOO_LARGE"); (error as any).code = "GOLD_TOO_LARGE"; throw error;
      }
      if (expectedResult && !goldInputHasSafeJson(expectedResult)) {
        const error = new Error("IMPORT_GOLD_EXPECTED_UNSAFE"); (error as any).code = "GOLD_UNSAFE"; throw error;
      }
      await auditImportedRecipeChanges(tx, before, after, requestCorrelationId(req));
      fail("after-recipe-audit");
      const resultHash = hash(after);
      const result = { operationId, resultHash, affectedEntities: Object.fromEntries(
        Object.entries(after).map(([key, value]) => [key, value.length]),
      ), ...(recipeQcChangedCount
        ? { recipeQcReview: { status: "applied-awaiting-review", changedCount: recipeQcChangedCount } }
        : {}) };
      const inserted = await tx.insert(importOperationsTable).values({
        id: operationId, scope, importType,
        sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 300) : null,
        sourceLabel: String(body.sourceLabel ?? "Import").slice(0, 300),
        actorId: req.userId ?? null, requestHash,
        expectedStateHash: body.expectedStateHash ? String(body.expectedStateHash) : beforeHash,
        resultHash, status: "applied", beforeSnapshot: before, afterSnapshot: after,
        distillEvidence: sourceEvidence.evidence ?? {},
        affectedEntities: result.affectedEntities, result,
      }).returning();
      await tx.insert(qcWorkflowEventsTable).values({
        scope, operationId: `import-commit:${operationId}`, recordId: operationId,
        eventType: "import-committed", actorId: req.userId!,
        payload: { operationId, resultHash, importType, summaryVersion: 1, summary: buildImportQcSummary(before, after) },
      });
      await tx.insert(importHistoryTable).values({
        scope, importType, sourceKey: body.sourceKey ? String(body.sourceKey).slice(0, 300) : null,
        sourceLabel: String(body.sourceLabel ?? "Import").slice(0, 300),
        customerScope: null, status: "complete", summary: result,
        snapshotId: null, operationId, actorId: req.userId ?? null,
      });
      if (goldInput && expectedResult) {
        await tx.insert(importGoldCasesTable).values({
          scope,
          operationId,
          importType,
          sourceLabel: GOLD_SOURCE_LABELS[importType as keyof typeof GOLD_SOURCE_LABELS],
          evaluatedInput: goldInput,
          expectedResult,
          createdBy: req.userId ?? null,
        }).onConflictDoNothing();
      }
      fail("after-history");
      return inserted[0];
    });
    if (changes.brandProfiles) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "profiles");
    }
    if (
      changes.mixes || changes.cheeseRecipes || changes.doughRecipes ||
      changes.sauceRecipes || changes.freezerPullItems
    ) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "master-data");
    }
    if (changes.specImportAliases) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "name-links");
    }
    res.json({ operation: operationApi(operation) });
  } catch (err: any) {
    if (err?.code === "STALE_REVIEW") { res.status(409).json({ error: "STALE_REVIEWED_STATE" }); return; }
    if (err?.code === "REQUEST_CHANGED") { res.status(409).json({ error: "IMPORT_REQUEST_CHANGED" }); return; }
    if (err?.code === "STALE_IMPORT") { res.status(409).json({ error: "STALE_IMPORT_REVISION" }); return; }
    if (err?.code === "GOLD_TOO_LARGE") { res.status(413).json({ error: "Applied result is too large to save as an evaluation case" }); return; }
    if (err?.code === "GOLD_UNSAFE") { res.status(422).json({ error: "Applied result contains unsupported or sensitive data for evaluation capture" }); return; }
    req.log.error({ err, operationId }, "atomic import apply failed");
    res.status(500).json({ error: "Import apply failed; no changes were committed" });
  }
});

async function getLocalGoldScoringEnabled(scope = currentScope()): Promise<boolean> {
  if (!isImportGoldDevelopmentRuntime()) return false;
  const [row] = await db.select({ value: factoryKvTable.value }).from(factoryKvTable).where(and(
    eq(factoryKvTable.scope, scope),
    eq(factoryKvTable.key, LOCAL_GOLD_SCORING_SETTING),
  )).limit(1);
  return row?.value === true;
}

function syntheticGoldCaseCondition() {
  return and(
    eq(importGoldCasesTable.operationId, SYNTHETIC_GOLD_OPERATION_ID),
    eq(importGoldCasesTable.sourceLabel, SYNTHETIC_GOLD_SOURCE_LABEL),
  );
}

router.get("/import-gold/config", requireCapability("manage-staff"), async (_req, res) => {
  const developmentRuntime = isImportGoldDevelopmentRuntime();
  const cleanupOnly = importGoldCleanupOnlyEnabled();
  const localConfigured = !cleanupOnly && developmentRuntime && isImportGoldLocalConfigured();
  const localBase = process.env.IMPORT_GOLD_LOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1";
  res.json({
    enabled: importGoldEnabled(),
    cleanupEnabled: cleanupOnly,
    localConfigured,
    localAvailable: localConfigured && await isImportGoldLocalAvailable(localBase),
    localScoringSwitchAvailable: !cleanupOnly && developmentRuntime,
    localScoringEnabled: !cleanupOnly && developmentRuntime && await getLocalGoldScoringEnabled(),
    syntheticFixtureAvailable: !cleanupOnly && developmentRuntime,
    geminiConfigured: !cleanupOnly && importGoldEnabled() && isGeminiProviderConfigured(),
    retention: "Real-source cases require recorded source-use and retention approval. Cases remain until a manager deletes them; exclusion only removes them from scoring and export.",
    persistsAcrossFactoryPurge: true,
  });
});

router.patch("/import-gold/local-scoring", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  if (!isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Development-only setting is unavailable" }); return; }
  const body = objectBody(req);
  if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "Invalid local-scoring setting" }); return;
  }
  const scope = currentScope();
  await db.insert(factoryKvTable).values({
    scope,
    key: LOCAL_GOLD_SCORING_SETTING,
    value: body.enabled,
  }).onConflictDoUpdate({
    target: [factoryKvTable.scope, factoryKvTable.key],
    set: { value: body.enabled, updatedAt: new Date() },
  });
  res.json({ enabled: body.enabled });
});

router.get("/import-gold/synthetic-review", requireCapability("manage-staff"), (_req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  if (!isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Development-only fixture is unavailable" }); return; }
  res.json({
    fixtureVersion: SYNTHETIC_GOLD_FIXTURE_VERSION,
    importType: SYNTHETIC_GOLD_FIXTURE.importType,
    sourceLabel: SYNTHETIC_GOLD_SOURCE_LABEL,
    input: SYNTHETIC_GOLD_FIXTURE.input,
    expectedResult: SYNTHETIC_GOLD_FIXTURE.expectedResult,
    applyEffect: "Creates a fixed synthetic evaluation case only; it does not change recipes, inventory, import approvals, or evaluator workflow state.",
  });
});

router.post("/import-gold/synthetic-apply", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  if (!isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Development-only fixture is unavailable" }); return; }
  const body = objectBody(req);
  if (
    !body || Object.keys(body).length !== 2 ||
    body.fixtureVersion !== SYNTHETIC_GOLD_FIXTURE_VERSION ||
    body.reviewed !== true
  ) {
    res.status(400).json({ error: "Review the available synthetic sample before applying it" }); return;
  }
  const scope = currentScope();
  const [created] = await db.insert(importGoldCasesTable).values({
    scope,
    operationId: SYNTHETIC_GOLD_OPERATION_ID,
    importType: SYNTHETIC_GOLD_FIXTURE.importType,
    sourceLabel: SYNTHETIC_GOLD_SOURCE_LABEL,
    evaluatedInput: SYNTHETIC_GOLD_FIXTURE.input,
    expectedResult: SYNTHETIC_GOLD_FIXTURE.expectedResult,
    createdBy: req.userId ?? null,
  }).onConflictDoNothing({
    target: [importGoldCasesTable.scope, importGoldCasesTable.operationId],
  }).returning({ id: importGoldCasesTable.id });
  const [stored] = created
    ? [created]
    : await db.select({ id: importGoldCasesTable.id }).from(importGoldCasesTable).where(and(
      eq(importGoldCasesTable.scope, scope),
      eq(importGoldCasesTable.operationId, SYNTHETIC_GOLD_OPERATION_ID),
      eq(importGoldCasesTable.sourceLabel, SYNTHETIC_GOLD_SOURCE_LABEL),
    )).limit(1);
  if (!stored) { res.status(500).json({ error: "The synthetic evaluation case could not be saved" }); return; }
  res.status(created ? 201 : 200).json({ caseId: stored.id, created: Boolean(created) });
});

router.get("/import-gold/cases", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  const realSourceAccess = importGoldEnabled();
  if (!realSourceAccess && !isImportGoldDevelopmentRuntime()) {
    res.status(404).json({ error: "Import gold is disabled" }); return;
  }
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GOLD_CASES) {
    res.status(400).json({ error: `Limit must be an integer from 1 to ${MAX_GOLD_CASES}` }); return;
  }
  const scope = currentScope();
  const cases = await db.select().from(importGoldCasesTable)
    .where(and(
      eq(importGoldCasesTable.scope, scope),
      ...(realSourceAccess ? [] : [syntheticGoldCaseCondition()!]),
    ))
    .orderBy(desc(importGoldCasesTable.createdAt), desc(importGoldCasesTable.id))
    .limit(limit);
  const scores = cases.length
    ? await db.selectDistinctOn([importGoldScoresTable.caseId, importGoldScoresTable.provider])
      .from(importGoldScoresTable)
      .where(and(eq(importGoldScoresTable.scope, scope), inArray(importGoldScoresTable.caseId, cases.map((row) => row.id))))
      .orderBy(importGoldScoresTable.caseId, importGoldScoresTable.provider, desc(importGoldScoresTable.createdAt), desc(importGoldScoresTable.id))
    : [];
  const recentByCase = new Map<number, typeof scores>();
  for (const score of scores) {
    const existing = recentByCase.get(score.caseId) ?? [];
    recentByCase.set(score.caseId, [...existing, score]);
  }
  res.json({
    cases: cases.map((row) => ({
      id: row.id,
      importType: row.importType,
      sourceLabel: row.sourceLabel,
      excluded: row.excluded,
      createdAt: row.createdAt.toISOString(),
      scores: recentByCase.get(row.id) ?? [],
    })),
  });
});

router.patch("/import-gold/cases/:id/exclusion", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  const realSourceAccess = importGoldEnabled();
  if (!realSourceAccess && !isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Import gold is disabled" }); return; }
  const id = Number(req.params.id);
  const body = objectBody(req);
  if (!Number.isSafeInteger(id) || id < 1 || !body || typeof body.excluded !== "boolean") {
    res.status(400).json({ error: "Invalid exclusion request" }); return;
  }
  const scope = currentScope();
  const [row] = await db.update(importGoldCasesTable)
    .set({ excluded: body.excluded, excludedAt: body.excluded ? new Date() : null })
    .where(and(
      eq(importGoldCasesTable.id, id),
      eq(importGoldCasesTable.scope, scope),
      ...(realSourceAccess ? [] : [syntheticGoldCaseCondition()!]),
    ))
    .returning({ id: importGoldCasesTable.id, excluded: importGoldCasesTable.excluded });
  if (!row) { res.status(404).json({ error: "Evaluation case not found" }); return; }
  res.json(row);
});

router.delete("/import-gold/cases/:id", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  const realSourceAccess = importGoldEnabled();
  if (!realSourceAccess && !isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Import gold is disabled" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid case identity" }); return; }
  const deleted = await db.delete(importGoldCasesTable).where(and(
    eq(importGoldCasesTable.id, id),
    eq(importGoldCasesTable.scope, currentScope()),
    ...(realSourceAccess ? [] : [syntheticGoldCaseCondition()!]),
  )).returning({ id: importGoldCasesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Evaluation case not found" }); return; }
  res.status(204).end();
});

router.get("/import-gold/cleanup-cases", requireCapability("manage-staff"), async (_req, res) => {
  if (!importGoldCleanupOnlyEnabled()) {
    res.status(404).json({ error: "Import gold cleanup is unavailable" });
    return;
  }
  const cases = await db.select({
    id: importGoldCasesTable.id,
    importType: importGoldCasesTable.importType,
    createdAt: importGoldCasesTable.createdAt,
  }).from(importGoldCasesTable)
    .where(eq(importGoldCasesTable.scope, currentScope()))
    .orderBy(desc(importGoldCasesTable.createdAt), desc(importGoldCasesTable.id))
    .limit(MAX_GOLD_CASES);
  res.json({
    cases: cases.map((row) => ({
      id: row.id,
      importType: row.importType,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

router.delete("/import-gold/cleanup-cases/:id", requireCapability("manage-staff"), async (req, res) => {
  if (!importGoldCleanupOnlyEnabled()) {
    res.status(404).json({ error: "Import gold cleanup is unavailable" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid case identity" });
    return;
  }
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx.delete(importGoldCasesTable).where(and(
      eq(importGoldCasesTable.id, id),
      eq(importGoldCasesTable.scope, currentScope()),
    )).returning({ id: importGoldCasesTable.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      action: "import_gold_case_deleted",
      resource: "import_gold_case",
      changes: { outcome: "success", targetId: String(row.id) },
    });
    return true;
  });
  if (!deleted) {
    res.status(404).json({ error: "Evaluation case not found" });
    return;
  }
  res.status(204).end();
});

router.get("/import-gold/export.jsonl", requireCapability("manage-staff"), async (_req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  const realSourceAccess = importGoldEnabled();
  if (!realSourceAccess && !isImportGoldDevelopmentRuntime()) { res.status(404).json({ error: "Import gold is disabled" }); return; }
  const cases = await db.select().from(importGoldCasesTable).where(and(
    eq(importGoldCasesTable.scope, currentScope()),
    eq(importGoldCasesTable.excluded, false),
    ...(realSourceAccess ? [] : [syntheticGoldCaseCondition()!]),
  )).orderBy(desc(importGoldCasesTable.createdAt), desc(importGoldCasesTable.id)).limit(MAX_GOLD_CASES);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="import-gold-cases.jsonl"');
  res.send(cases.map((row) => JSON.stringify({
    id: row.id,
    importType: row.importType,
    createdAt: row.createdAt.toISOString(),
    evaluatedInput: row.evaluatedInput,
    expectedResult: row.expectedResult,
  })).join("\n") + (cases.length ? "\n" : ""));
});

router.post("/import-gold/score", requireCapability("manage-staff"), async (req, res) => {
  if (rejectImportGoldContentDuringCleanup(res)) return;
  const realSourceAccess = importGoldEnabled();
  const developmentRuntime = isImportGoldDevelopmentRuntime();
  const body = objectBody(req);
  const provider = body?.provider;
  const requestedIds = body?.caseIds;
  if (
    !body || (provider !== "local" && provider !== "gemini") ||
    (requestedIds !== undefined && (!Array.isArray(requestedIds) || requestedIds.length > MAX_GOLD_SCORE_CASES ||
      requestedIds.some((id) => !Number.isSafeInteger(id) || Number(id) < 1)))
  ) {
    res.status(400).json({ error: "Invalid score request" }); return;
  }
  if (!realSourceAccess && !(developmentRuntime && provider === "local")) {
    res.status(404).json({ error: "Import gold is disabled" }); return;
  }
  if (provider === "local" && !developmentRuntime) {
    res.status(403).json({ error: "Local scoring is available only in a development workspace" }); return;
  }
  if (provider === "local" && !await getLocalGoldScoringEnabled()) {
    res.status(403).json({ error: "Local scoring is disabled in this development workspace" }); return;
  }
  if (provider === "local" && !isImportGoldLocalConfigured()) {
    res.status(503).json({ error: "The local evaluator is not configured" }); return;
  }
  if (provider === "gemini" && (!realSourceAccess || !isGeminiProviderConfigured())) {
    res.status(503).json({ error: "Gemini comparison is not configured" }); return;
  }
  const scope = currentScope();
  const ids = requestedIds as number[] | undefined;
  const eligible = await db.select().from(importGoldCasesTable).where(and(
    eq(importGoldCasesTable.scope, scope),
    eq(importGoldCasesTable.excluded, false),
    ...(!realSourceAccess ? [syntheticGoldCaseCondition()!] : []),
    ...(ids ? [inArray(importGoldCasesTable.id, ids)] : []),
  )).orderBy(desc(importGoldCasesTable.createdAt), desc(importGoldCasesTable.id)).limit(MAX_GOLD_SCORE_CASES);
  const results = [];
  for (const goldCase of eligible) {
    try {
      const predictionCandidate = process.env.NODE_ENV === "test" && goldProviderTestOverride
        ? await goldProviderTestOverride(provider, goldCase.evaluatedInput, goldCase.importType)
        : provider === "local"
          ? await requestLocalGoldPrediction(goldCase.evaluatedInput, goldCase.importType, goldCase.expectedResult)
          : await requestGeminiGoldPrediction(goldCase.evaluatedInput, goldCase.importType, goldCase.expectedResult);
      const prediction = validateGoldPrediction(predictionCandidate, goldCase.expectedResult);
      const comparison = compareImportGoldFields(goldCase.expectedResult, prediction);
      const [score] = await db.insert(importGoldScoresTable).values({
        scope,
        caseId: goldCase.id,
        provider,
        status: "scored",
        accuracy: comparison.accuracy,
        comparedFields: comparison.comparedFields,
        equalFields: comparison.equalFields,
        fieldDiffs: comparison.fieldDiffs,
      }).returning();
      results.push({ caseId: goldCase.id, provider, status: "scored", accuracy: comparison.accuracy, comparedFields: comparison.comparedFields, equalFields: comparison.equalFields, fieldDiffs: comparison.fieldDiffs, scoreId: score.id });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const errorCode = rawCode === "provider_not_configured" ? "provider_not_configured"
        : rawCode === "invalid_output" ? "invalid_output" : "provider_unavailable";
      const [score] = await db.insert(importGoldScoresTable).values({
        scope, caseId: goldCase.id, provider, status: "error", errorCode,
      }).returning();
      results.push({ caseId: goldCase.id, provider, status: "error", errorCode, scoreId: score.id });
    }
  }
  res.json({ results, scoredCount: results.filter((result) => result.status === "scored").length, errorCount: results.filter((result) => result.status === "error").length });
});

type ExportCursor = { createdAt: string; id: string };
function decodeExportCursor(value: unknown): ExportCursor | null | false {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      !parsed || typeof parsed !== "object" ||
      typeof parsed.createdAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(parsed.createdAt) ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{16,120}$/.test(parsed.id)
    ) return false;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return false;
  }
}

router.get(
  "/import-operations/distillation-evidence",
  requireLiveScope,
  requireCapability("manage-profiles"),
  async (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? MAX_EXPORT_PAGE_SIZE : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPORT_PAGE_SIZE) {
      res.status(400).json({ error: `Limit must be an integer from 1 to ${MAX_EXPORT_PAGE_SIZE}` });
      return;
    }
    const cursor = decodeExportCursor(req.query.cursor);
    if (cursor === false) {
      res.status(400).json({ error: "Invalid export cursor" });
      return;
    }
    const predicates = [
      eq(importOperationsTable.scope, "live"),
      eq(importOperationsTable.importType, "spec"),
      eq(importOperationsTable.status, "applied"),
      isNull(importOperationsTable.undoneAt),
      gt(importOperationsTable.createdAt, new Date(Date.now() - IMPORT_SOURCE_RETENTION_MS)),
      sql`${importOperationsTable.distillEvidence}->>'format' = 'spec-apply-source-v1'`,
      sql`${importOperationsTable.distillEvidence}->>'actorCapability' = 'manage-profiles'`,
      sql`${importOperationsTable.distillEvidence}->>'parseVersion' = ${SPEC_IMPORT_PARSE_VERSION}`,
      sql`length(${importOperationsTable.distillEvidence}->>'sourceText') > 0`,
    ];
    if (cursor) {
      predicates.push(or(
        sql`${importOperationsTable.createdAt} < ${cursor.createdAt}::timestamptz`,
        and(
          sql`${importOperationsTable.createdAt} = ${cursor.createdAt}::timestamptz`,
          sql`${importOperationsTable.id} < ${cursor.id}`,
        ),
      )!);
    }
    const rows = await db.select({
      record: importOperationsTable,
      cursorCreatedAt: sql<string>`to_char(${importOperationsTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(importOperationsTable)
      .where(and(...predicates))
      .orderBy(desc(importOperationsTable.createdAt), desc(importOperationsTable.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const records = page.flatMap(({ record: row }) => {
      const evidence = row.distillEvidence as Record<string, unknown>;
      const appliedValues = row.afterSnapshot;
      if (
        row.scope !== "live" || row.importType !== "spec" || row.status !== "applied" ||
        row.undoneAt !== null || !row.actorId ||
        typeof evidence.sourceText !== "string" || !evidence.sourceText.trim() ||
        Buffer.byteLength(evidence.sourceText, "utf8") > MAX_SOURCE_EVIDENCE_BYTES ||
        evidence.format !== "spec-apply-source-v1" ||
        typeof evidence.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.sourceSha256) ||
        createHash("sha256").update(evidence.sourceText).digest("hex") !== evidence.sourceSha256 ||
        evidence.actorCapability !== "manage-profiles" ||
        typeof evidence.actorIdSha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.actorIdSha256) ||
        createHash("sha256").update(row.actorId).digest("hex") !== evidence.actorIdSha256 ||
        evidence.parseVersion !== SPEC_IMPORT_PARSE_VERSION ||
        !appliedValues || typeof appliedValues !== "object" || Array.isArray(appliedValues) ||
        !row.resultHash || hash(appliedValues) !== row.resultHash
      ) return [];
      return [{
        operationId: row.id,
        importType: row.importType,
        scope: "live" as const,
        status: "applied" as const,
        undoneAt: null,
        actorCapability: "manage-profiles" as const,
        actorIdSha256: evidence.actorIdSha256,
        sourceSha256: evidence.sourceSha256,
        appliedAt: row.createdAt.toISOString(),
        sourceText: evidence.sourceText,
        parseVersion: SPEC_IMPORT_PARSE_VERSION,
        appliedValues,
      }];
    });
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.cursorCreatedAt, id: last.record.id })).toString("base64url")
      : null;
    res.json({ records, nextCursor });
  },
);

router.get("/import-operations/:operationId", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req, res) => {
  const row = await db.select().from(importOperationsTable).where(and(
    eq(importOperationsTable.id, String(req.params.operationId)), eq(importOperationsTable.scope, currentScope()),
  )).limit(1);
  if (!row[0]) { res.status(404).json({ error: "Import operation not found" }); return; }
  if (!requireOperationCapability(req, res, row[0].importType)) return;
  res.json({ operation: operationApi(row[0]) });
});

/** Read-only advisory check; Undo always rechecks under its transaction lock. */
export async function inspectImportUndo(id: string, capabilities: readonly string[]): Promise<boolean> {
  const [op] = await db.select().from(importOperationsTable).where(and(
    eq(importOperationsTable.id, id), eq(importOperationsTable.scope, currentScope()),
  )).limit(1);
  if (!op || op.status !== "applied" || !op.resultHash) return false;
  const before = op.beforeSnapshot as Record<string, unknown[]>;
  const after = op.afterSnapshot as Record<string, unknown[]>;
  const needed = new Set([...snapshotCapabilities(before), ...snapshotCapabilities(after)]);
  if (![...needed].every((entry) => capabilities.includes(entry))) return false;
  // Same top-level gate as the existing Undo route, even for alias-only changes.
  if (!capabilities.some((entry) => entry === "manage-profiles" || entry === "manage-inventory")) return false;
  const current = await captureSnapshotRows(db, after, currentScope(), before);
  return hash(current) === op.resultHash;
}

router.post("/import-operations/:operationId/undo", requireAnyCapability(["manage-profiles", "manage-inventory"]), async (req, res) => {
  const id = String(req.params.operationId);
  try {
    const undone = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + currentScope()}, 0))`);
      const found = await tx.select().from(importOperationsTable).where(and(
        eq(importOperationsTable.id, id), eq(importOperationsTable.scope, currentScope()),
      )).limit(1);
      if (!found[0]) { const e = new Error("NOT_FOUND"); (e as any).code = "NOT_FOUND"; throw e; }
      const op = found[0];
       const needed = new Set([
         ...snapshotCapabilities(op.beforeSnapshot as Record<string, unknown[]>),
         ...snapshotCapabilities(op.afterSnapshot as Record<string, unknown[]>),
       ]);
       if ([...needed].some((entry) => !(req.capabilities ?? []).includes(entry))) {
        const e = new Error("FORBIDDEN"); (e as any).code = "FORBIDDEN"; throw e;
      }
      if (op.status === "undone") return op;
      if (op.status !== "applied") { const e = new Error("NOT_UNDOABLE"); (e as any).code = "NOT_UNDOABLE"; throw e; }
      if (req.body?.expectedResultHash && String(req.body.expectedResultHash) !== op.resultHash) {
        const e = new Error("RESULT_CHANGED"); (e as any).code = "RESULT_CHANGED"; throw e;
      }
      const current = await captureSnapshotRows(
        tx,
        op.afterSnapshot as Record<string, unknown[]>,
        currentScope(),
        op.beforeSnapshot as Record<string, unknown[]>,
      );
      if (hash(current) !== op.resultHash) { const e = new Error("IMPORT_CHANGED"); (e as any).code = "IMPORT_CHANGED"; throw e; }
      await restore(
        tx,
        op.beforeSnapshot as Record<string, unknown[]>,
        op.afterSnapshot as Record<string, unknown[]>,
        currentScope(),
      );
      const updated = await tx.update(importOperationsTable).set({
        status: "undone", undoneAt: new Date(), undoneBy: req.userId ?? null, updatedAt: new Date(),
      }).where(and(eq(importOperationsTable.id, id), eq(importOperationsTable.scope, currentScope()))).returning();
      return updated[0];
    });
    const before = undone.beforeSnapshot as Record<string, unknown[]> | undefined;
    const after = undone.afterSnapshot as Record<string, unknown[]> | undefined;
    if (before?.brandProfiles || after?.brandProfiles) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "profiles");
    }
    if (
      before?.mixes || after?.mixes || before?.cheeseRecipes || after?.cheeseRecipes ||
      before?.doughRecipes || after?.doughRecipes || before?.sauceRecipes || after?.sauceRecipes ||
      before?.freezerPullItems || after?.freezerPullItems
    ) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "master-data");
    }
    if (before?.specImportAliasKeys || after?.specImportAliasKeys) {
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", currentScope(), "name-links");
    }
    res.json({ operation: operationApi(undone) });
  } catch (err: any) {
    if (err?.code === "NOT_FOUND") { res.status(404).json({ error: "Import operation not found" }); return; }
    if (err?.code === "FORBIDDEN") { res.status(403).json({ error: `Missing capability for this importer` }); return; }
    if (err?.code === "RESULT_CHANGED") { res.status(409).json({ error: "IMPORT_RESULT_HASH_MISMATCH" }); return; }
    if (err?.code === "IMPORT_CHANGED") { res.status(409).json({ error: "IMPORT_CHANGED_SINCE_APPLY" }); return; }
    if (err?.code === "NOT_UNDOABLE") { res.status(409).json({ error: "IMPORT_NOT_UNDOABLE" }); return; }
    req.log.error({ err, operationId: id }, "atomic import undo failed");
    res.status(500).json({ error: "Import undo failed; no changes were committed" });
  }
});

export default router;
