import { createHash } from "node:crypto";

export const DISTILL_DATASET_VERSION = 1 as const;
export const NEAR_DUPLICATE_POLICY = {
  shingleMode: "word",
  shingleSize: 3,
  threshold: 0.85,
  normalizeVersion: 1,
} as const;

export type DistillSource = "corpus" | "applylog";
export type DistillPartition = "train" | "development" | "holdout" | "quarantine";
export type VerificationPath = "deterministic-agreement" | "human-apply";
export type DistillMessage = { role: "system" | "user" | "assistant"; content: string };

export type DistillCandidateInput = {
  source: DistillSource;
  brand: string;
  sourceText: string;
  userContent: string;
  assistantText: string;
  criticalFields: string[];
  parseVersion: string;
  systemPromptSha256: string;
  goldValues?: Record<string, unknown>;
  deterministicValues?: Record<string, unknown>;
  goldEvidence?: {
    kind: "independent-human-gold";
    reviewerCapability: "review-spec-gold";
    sourceSha256: string;
    reviewerIdSha256: string;
    reviewedAt: string;
    fieldPaths: string[];
    goldValuesSha256: string;
  };
  humanApply?: {
    operationId: string;
    scope: "live";
    status: "applied" | "undone" | "applying";
    actorCapability: string;
    actorIdSha256: string;
    appliedAt: string;
    sourceSha256: string;
    appliedValues: Record<string, unknown>;
    recordSha256: string;
  };
};

export type VerifiedCandidate = {
  id: string;
  brand: string;
  source: DistillSource;
  verificationPath: VerificationPath;
  sourceSha256: string;
  sourceEvidenceSha256: string;
  userContent: string;
  assistantContent: string;
  criticalFields: string[];
  goldValues: Record<string, unknown>;
  parseVersion: string;
  editDistance?: number;
};

export type CandidateVerification =
  | { state: "verified"; candidate: VerifiedCandidate }
  | { state: "quarantine"; id: string; reasons: string[]; brand?: string; source?: string };

export type SafetyOptions = {
  criticalFields: string[];
  goldValues: Record<string, unknown>;
  expectedSystemPrompt: string;
  currentParseVersion: string;
  sourceSha256: string;
  sourceEvidenceSha256: string;
};

export type TrainSafetyResult = { safe: boolean; reasons: string[] };

export type RedactionConfig = {
  version: 1;
  replacement: string;
  sensitiveHeaders: string[];
  literalValues?: string[];
};

const SHA256_RE = /^[a-f0-9]{64}$/;
const MISSING = Symbol("missing");

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value is not JSON serializable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

export function hashCriticalGoldEvidence(input: {
  sourceSha256: string;
  criticalFields: string[];
  goldValues: Record<string, unknown>;
}): string {
  const values = Object.fromEntries([...input.criticalFields].sort().map((field) => [
    field,
    input.goldValues[field],
  ]));
  return sha256(canonicalJson({
    format: "distill-critical-gold-evidence",
    sourceSha256: input.sourceSha256,
    values,
  }));
}

export function hashHumanApplyRecord(input: Omit<
  NonNullable<DistillCandidateInput["humanApply"]>,
  "recordSha256"
>): string {
  return sha256(canonicalJson({
    format: "distill-human-apply-record",
    operationId: input.operationId,
    scope: input.scope,
    status: input.status,
    actorCapability: input.actorCapability,
    actorIdSha256: input.actorIdSha256,
    appliedAt: input.appliedAt,
    sourceSha256: input.sourceSha256,
    appliedValues: input.appliedValues,
  }));
}

function pathValue(value: unknown, dottedPath: string): unknown | typeof MISSING {
  const parts = dottedPath.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (isRecord(current) && Object.hasOwn(current, part)) {
      current = current[part];
      continue;
    }
    return MISSING;
  }
  return current;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]));
  }
  return Object.is(left, right);
}

function parseAssistant(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function candidateId(input: unknown): string {
  return sha256(canonicalJson(input));
}

function hasCriticalValues(
  values: Record<string, unknown>,
  criticalFields: string[],
): boolean {
  return criticalFields.every((field) => pathValue(values, field) !== MISSING);
}

function hasMappedCriticalValues(
  values: Record<string, unknown>,
  criticalFields: string[],
): boolean {
  return criticalFields.every((field) => Object.hasOwn(values, field));
}

function reasonsForInput(input: unknown): string[] {
  if (!isRecord(input)) return ["candidate_not_object"];
  const reasons: string[] = [];
  if (input.source !== "corpus" && input.source !== "applylog") reasons.push("unsupported_source");
  if (typeof input.brand !== "string" || !input.brand.trim()) reasons.push("missing_brand");
  if (typeof input.sourceText !== "string" || !input.sourceText.trim()) reasons.push("missing_source_text");
  if (typeof input.userContent !== "string" || !input.userContent.trim()) reasons.push("missing_user_content");
  if (typeof input.assistantText !== "string") reasons.push("missing_assistant_output");
  if (!Array.isArray(input.criticalFields)
    || input.criticalFields.length === 0
    || input.criticalFields.some((field) => typeof field !== "string" || !field.trim())
  ) {
    reasons.push("missing_critical_fields");
  }
  if (typeof input.parseVersion !== "string" || !input.parseVersion) reasons.push("missing_parse_version");
  if (typeof input.systemPromptSha256 !== "string" || !SHA256_RE.test(input.systemPromptSha256)) {
    reasons.push("invalid_prompt_hash");
  }
  return reasons;
}

export function verifyCandidate(
  value: unknown,
  contract: { systemPromptSha256: string; currentParseVersion: string },
): CandidateVerification {
  const id = candidateId(value);
  if (!isRecord(value)) return { state: "quarantine", id, reasons: ["candidate_not_object"] };
  const initialReasons = reasonsForInput(value);
  if (initialReasons.length) {
    return {
      state: "quarantine",
      id,
      reasons: initialReasons,
      brand: typeof value.brand === "string" ? value.brand : undefined,
      source: typeof value.source === "string" ? value.source : undefined,
    };
  }

  const input = value as unknown as DistillCandidateInput;
  const sourceSha256 = sha256(input.sourceText);
  const reasons: string[] = [];
  if (!input.userContent.includes(input.sourceText)) reasons.push("source_text_not_bound_to_user_message");
  if (input.parseVersion !== contract.currentParseVersion) reasons.push("parse_version_mismatch");
  if (input.systemPromptSha256 !== contract.systemPromptSha256) reasons.push("production_prompt_mismatch");
  if (new Set(input.criticalFields).size !== input.criticalFields.length) reasons.push("duplicate_critical_field");
  if (input.criticalFields.some((field) => !/^[A-Za-z0-9_$-]+(?:\.(?:[A-Za-z0-9_$-]+|\d+))*$/.test(field))) {
    reasons.push("invalid_critical_field_path");
  }

  let verificationPath: VerificationPath | null = null;
  let assistantContent = input.assistantText;
  let goldValues: Record<string, unknown> = {};
  let sourceEvidenceSha256 = "";
  let editDistance: number | undefined;

  if (input.source === "corpus") {
    const evidence = input.goldEvidence;
    if (
      !isRecord(evidence)
      || evidence.kind !== "independent-human-gold"
      || evidence.reviewerCapability !== "review-spec-gold"
      || evidence.sourceSha256 !== sourceSha256
      || !SHA256_RE.test(evidence.reviewerIdSha256)
      || !isIsoDate(evidence.reviewedAt)
      || !Array.isArray(evidence.fieldPaths)
      || !isRecord(input.goldValues)
      || !isRecord(input.deterministicValues)
    ) {
      reasons.push("missing_source_backed_gold");
    } else {
      sourceEvidenceSha256 = evidence.sourceSha256;
      const evidencedFields = new Set(evidence.fieldPaths);
      if (input.criticalFields.some((field) => !evidencedFields.has(field))) {
        reasons.push("critical_gold_field_not_evidenced");
      }
      const completeGoldValues = hasMappedCriticalValues(input.goldValues, input.criticalFields);
      if (!completeGoldValues) reasons.push("gold_missing_critical_value");
      if (
        !completeGoldValues
        || !isSha256(evidence.goldValuesSha256)
        || evidence.goldValuesSha256 !== hashCriticalGoldEvidence({
          sourceSha256,
          criticalFields: input.criticalFields,
          goldValues: input.goldValues,
        })
      ) reasons.push("gold_values_hash_mismatch");
      const parsedAssistant = parseAssistant(input.assistantText);
      if (!parsedAssistant) reasons.push("assistant_output_not_json_object");
      if (!hasCriticalValues(input.deterministicValues, input.criticalFields)) {
        reasons.push("deterministic_output_missing_critical_value");
      }
      for (const field of input.criticalFields) {
        if (!(field in input.goldValues)) continue;
        const gold = input.goldValues[field];
        if (pathValue(input.deterministicValues, field) === MISSING
          || !valuesEqual(pathValue(input.deterministicValues, field), gold)
        ) reasons.push(`deterministic_mismatch:${field}`);
        if (!parsedAssistant || pathValue(parsedAssistant, field) === MISSING
          || !valuesEqual(pathValue(parsedAssistant, field), gold)
        ) reasons.push(`assistant_mismatch:${field}`);
      }
      if (reasons.length === 0) {
        verificationPath = "deterministic-agreement";
        goldValues = input.goldValues;
        assistantContent = canonicalJson(parsedAssistant);
      }
    }
  } else {
    const applyValue = input.humanApply;
    if (!isRecord(applyValue)) {
      reasons.push("missing_human_apply_record");
    } else {
      const apply = applyValue as NonNullable<DistillCandidateInput["humanApply"]>;
      if (apply.scope !== "live") reasons.push("apply_record_not_live_scope");
      if (apply.status !== "applied") reasons.push("apply_record_not_applied");
      if (apply.actorCapability !== "manage-profiles") reasons.push("apply_actor_not_authorized");
      if (!SHA256_RE.test(apply.actorIdSha256)) reasons.push("invalid_apply_actor_hash");
      if (!/^[A-Za-z0-9_-]{16,120}$/.test(apply.operationId)) reasons.push("invalid_apply_operation_id");
      if (!isIsoDate(apply.appliedAt)) reasons.push("invalid_apply_timestamp");
      if (apply.sourceSha256 !== sourceSha256) reasons.push("apply_source_hash_mismatch");
      const canHashApplyRecord =
        typeof apply.operationId === "string"
        && apply.scope === "live"
        && typeof apply.status === "string"
        && typeof apply.actorCapability === "string"
        && typeof apply.actorIdSha256 === "string"
        && typeof apply.appliedAt === "string"
        && typeof apply.sourceSha256 === "string"
        && isRecord(apply.appliedValues);
      const applyRecordSha256 = canHashApplyRecord ? hashHumanApplyRecord(apply) : null;
      if (
        !applyRecordSha256
        || !SHA256_RE.test(apply.recordSha256)
        || apply.recordSha256 !== applyRecordSha256
      ) reasons.push("apply_record_hash_mismatch");
      if (!isRecord(apply.appliedValues) || !hasCriticalValues(apply.appliedValues, input.criticalFields)) {
        reasons.push("apply_output_missing_critical_value");
      }
      if (reasons.length === 0) {
        verificationPath = "human-apply";
        sourceEvidenceSha256 = apply.sourceSha256;
        goldValues = Object.fromEntries(input.criticalFields.map((field) => [
          field,
          pathValue(apply.appliedValues, field),
        ]));
        assistantContent = canonicalJson(apply.appliedValues);
        editDistance = levenshteinDistance(input.assistantText, assistantContent);
      }
    }
  }

  if (reasons.length || !verificationPath) {
    return {
      state: "quarantine",
      id,
      reasons: [...new Set(reasons.length ? reasons : ["unverified_candidate"])],
      brand: input.brand,
      source: input.source,
    };
  }

  return {
    state: "verified",
    candidate: {
      id,
      brand: input.brand,
      source: input.source,
      verificationPath,
      sourceSha256,
      sourceEvidenceSha256,
      userContent: input.userContent,
      assistantContent,
      criticalFields: [...input.criticalFields],
      goldValues,
      parseVersion: input.parseVersion,
      ...(editDistance === undefined ? {} : { editDistance }),
    },
  };
}

export function assessTrainSafety(
  example: { messages: DistillMessage[]; parseVersion: string },
  options: SafetyOptions,
): TrainSafetyResult {
  const reasons: string[] = [];
  if (!Array.isArray(example.messages) || example.messages.length !== 3) {
    reasons.push("message format must contain exactly system, user, and assistant");
    return { safe: false, reasons };
  }
  const [system, user, assistant] = example.messages;
  if (system.role !== "system" || user.role !== "user" || assistant.role !== "assistant") {
    reasons.push("message roles must be system, user, assistant in order");
  }
  if (system.content !== options.expectedSystemPrompt) reasons.push("system prompt differs from production pin");
  if (!user.content.trim()) reasons.push("user content is empty");
  if (!assistant.content.trim()) reasons.push("assistant content is empty");
  if (/^\s*```/i.test(assistant.content) || /```json/i.test(assistant.content)) {
    reasons.push("assistant content contains markdown fences");
  }
  if (example.parseVersion !== options.currentParseVersion) {
    reasons.push("parse version differs from current production parse version");
  }
  if (
    !SHA256_RE.test(options.sourceSha256)
    || !SHA256_RE.test(options.sourceEvidenceSha256)
    || options.sourceSha256 !== options.sourceEvidenceSha256
  ) {
    reasons.push("gold values are not bound to the candidate source");
  }
  const parsedAssistant = parseAssistant(assistant.content);
  if (!parsedAssistant) reasons.push("assistant content is not a JSON object");
  for (const field of options.criticalFields) {
    if (!Object.hasOwn(options.goldValues, field)) {
      reasons.push(`gold value missing for critical field "${field}"`);
      continue;
    }
    if (
      !parsedAssistant
      || pathValue(parsedAssistant, field) === MISSING
      || !valuesEqual(pathValue(parsedAssistant, field), options.goldValues[field])
    ) {
      reasons.push(`critical field "${field}" does not match source-backed gold`);
    }
  }
  return { safe: reasons.length === 0, reasons };
}

export function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function assignBrandPartitions(
  brands: string[],
): { partitions: Map<string, Exclude<DistillPartition, "quarantine">>; warnings: string[] } {
  const unique = [...new Set(brands.map((brand) => brand.trim()).filter(Boolean))];
  const ordered = unique.sort((left, right) => sha256(left).localeCompare(sha256(right)));
  const count = ordered.length;
  const warnings = count < 7
    ? [`only ${count} brands are available; a small brand holdout needs explicit acknowledgment`]
    : [];

  const ratios = [
    { partition: "train" as const, ratio: 0.70 },
    { partition: "development" as const, ratio: 0.15 },
    { partition: "holdout" as const, ratio: 0.15 },
  ];
  const counts = new Map(ratios.map(({ partition, ratio }) => [partition, Math.floor(count * ratio)]));
  let remainder = count - [...counts.values()].reduce((sum, value) => sum + value, 0);
  const tieRank = { holdout: 0, development: 1, train: 2 } as const;
  const fractionalOrder = [...ratios].sort((left, right) =>
    (count * right.ratio - Math.floor(count * right.ratio))
      - (count * left.ratio - Math.floor(count * left.ratio))
      || tieRank[left.partition] - tieRank[right.partition],
  );
  for (const { partition } of fractionalOrder) {
    if (remainder <= 0) break;
    counts.set(partition, (counts.get(partition) ?? 0) + 1);
    remainder--;
  }
  let trainCount = counts.get("train") ?? 0;
  let developmentCount = counts.get("development") ?? 0;
  let holdoutCount = counts.get("holdout") ?? 0;
  if (count >= 3 && developmentCount === 0) {
    developmentCount = 1;
    trainCount--;
  }
  if (count >= 2 && holdoutCount === 0) {
    holdoutCount = 1;
    trainCount--;
  }
  const partitions = new Map<string, Exclude<DistillPartition, "quarantine">>();
  ordered.forEach((brand, index) => {
    partitions.set(
      brand,
      index < trainCount
        ? "train"
        : index < trainCount + developmentCount
          ? "development"
          : "holdout",
    );
  });
  if (count === 1) warnings.push("one brand cannot provide a separate development or holdout partition");
  if (count === 2) warnings.push("two brands cannot provide a separate development partition");
  return { partitions, warnings };
}

export function assertBrandPartitionIntegrity(
  entries: Array<{ brand: string; partition: DistillPartition }>,
): void {
  const seen = new Map<string, Exclude<DistillPartition, "quarantine">>();
  for (const entry of entries) {
    if (entry.partition === "quarantine") continue;
    const prior = seen.get(entry.brand);
    if (prior && prior !== entry.partition) {
      throw new Error(`brand partition leak: one brand appears in ${prior} and ${entry.partition}`);
    }
    seen.set(entry.brand, entry.partition);
  }
}

export function assertNoCrossPartitionContentDuplicates(
  entries: Array<{ contentSha256: string; partition: DistillPartition }>,
): void {
  const seen = new Map<string, Exclude<DistillPartition, "quarantine">>();
  for (const entry of entries) {
    if (entry.partition === "quarantine") continue;
    const prior = seen.get(entry.contentSha256);
    if (prior && prior !== entry.partition) {
      throw new Error(`content hash leak across ${prior} and ${entry.partition}`);
    }
    seen.set(entry.contentSha256, entry.partition);
  }
}

export function normalizeForNearDup(text: string, version = 1): string {
  if (version !== 1) throw new Error(`unsupported near-duplicate normalization version ${version}`);
  return text.normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

export function shingleSet(
  text: string,
  config: { shingleSize?: number; normalizeVersion?: number } = {},
): Set<string> {
  const shingleSize = config.shingleSize ?? NEAR_DUPLICATE_POLICY.shingleSize;
  if (!Number.isInteger(shingleSize) || shingleSize < 1 || shingleSize > 12) {
    throw new Error("shingleSize must be an integer between 1 and 12");
  }
  const words = normalizeForNearDup(text, config.normalizeVersion)
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length < shingleSize) return new Set();
  const shingles = new Set<string>();
  for (let index = 0; index <= words.length - shingleSize; index++) {
    shingles.add(words.slice(index, index + shingleSize).join(" "));
  }
  return shingles;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

export function trainNearDupFlags(
  train: Array<{ id: string; text: string }>,
  evaluation: Array<{ id: string; text: string }>,
  config: { threshold?: number; shingleSize?: number; normalizeVersion?: number } = {},
): Map<string, { flag: boolean; maxScore: number; matchedId?: string }> {
  const threshold = config.threshold ?? NEAR_DUPLICATE_POLICY.threshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("near-duplicate threshold must be between 0 and 1");
  }
  const evalSets = evaluation.map((item) => ({
    id: item.id,
    shingles: shingleSet(item.text, config),
  }));
  const results = new Map<string, { flag: boolean; maxScore: number; matchedId?: string }>();
  for (const item of train) {
    const shingles = shingleSet(item.text, config);
    let maxScore = 0;
    let matchedId: string | undefined;
    for (const candidate of evalSets) {
      const score = jaccard(shingles, candidate.shingles);
      if (score > maxScore || (score === maxScore && score >= threshold && candidate.id < (matchedId ?? "\uffff"))) {
        maxScore = score;
        matchedId = candidate.id;
      }
    }
    results.set(item.id, {
      flag: maxScore >= threshold,
      maxScore,
      ...(matchedId && maxScore >= threshold ? { matchedId } : {}),
    });
  }
  return results;
}

function normalizedHeader(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

export function validateRedactionConfig(value: unknown): RedactionConfig {
  if (!isRecord(value) || value.version !== 1) throw new Error("redaction config version must be 1");
  if (
    typeof value.replacement !== "string"
    || !value.replacement
    || value.replacement.length > 80
    || /[\t\r\n]/u.test(value.replacement)
  ) {
    throw new Error("redaction replacement must be a non-empty, single-cell string of at most 80 characters");
  }
  if (
    !Array.isArray(value.sensitiveHeaders)
    || value.sensitiveHeaders.length > 100
    || value.sensitiveHeaders.some((header) => typeof header !== "string" || !header.trim())
  ) {
    throw new Error("sensitiveHeaders must be a list of at most 100 non-empty names");
  }
  const literalValues = value.literalValues ?? [];
  if (
    !Array.isArray(literalValues)
    || literalValues.length > 500
    || literalValues.some((item) => typeof item !== "string" || item.length < 4 || item.length > 500)
  ) {
    throw new Error("literalValues must contain at most 500 strings between 4 and 500 characters");
  }
  return {
    version: 1,
    replacement: value.replacement,
    sensitiveHeaders: [...new Set((value.sensitiveHeaders as string[]).map((header) => header.trim()))],
    literalValues: [...new Set(literalValues as string[])],
  };
}

/**
 * Redacts a private copy of flattened workbook text. Tab/newline boundaries
 * remain unchanged; configured sensitive columns are replaced cell by cell.
 */
export function redactPrivateCopy(text: string, config: RedactionConfig): string {
  let copy = text;
  for (const literal of config.literalValues ?? []) {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    copy = copy.replace(new RegExp(escaped, "giu"), config.replacement);
  }
  const sensitiveHeaders = new Set(config.sensitiveHeaders.map(normalizedHeader));
  let activeSensitiveColumns: Set<number> = new Set();
  return copy.split(/\r?\n/u).map((line) => {
    if (!line.includes("\t")) {
      activeSensitiveColumns = new Set();
      return line;
    }
    const cells = line.split("\t");
    const foundHeaders = new Set<number>();
    cells.forEach((cell, index) => {
      if (sensitiveHeaders.has(normalizedHeader(cell))) foundHeaders.add(index);
    });
    if (foundHeaders.size) {
      activeSensitiveColumns = foundHeaders;
      return line;
    }
    if (!activeSensitiveColumns.size) return line;
    return cells.map((cell, index) =>
      activeSensitiveColumns.has(index) && cell.trim() ? config.replacement : cell
    ).join("\t");
  }).join("\n");
}
