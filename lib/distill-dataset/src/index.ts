/**
 * Distillation dataset manifest types and validators.
 *
 * Public/git-safe: metadata + content hashes only.
 * Private store: full chat messages (system + user + assistant JSON).
 *
 * Train examples must pass train-safety rules before partition "train".
 */

export const DISTILL_MANIFEST_VERSION = 1 as const;

export type DistillPartition = "train" | "dev" | "holdout" | "quarantine";

export type DistillVerified =
  | "human-apply"
  | "deterministic-agreement"
  | "both";

export type DistillSource = "corpus-snapshot" | "apply-log" | "manual";

export type DistillChatRole = "system" | "user" | "assistant";

export type DistillChatMessage = {
  role: DistillChatRole;
  content: string;
};

/** Git-safe row: no raw workbook or model payload. */
export type DistillManifestEntry = {
  manifestVersion: typeof DISTILL_MANIFEST_VERSION;
  id: string;
  partition: DistillPartition;
  brandCode: string;
  verified: DistillVerified;
  schemaVersion: number;
  contentSha256: string;
  source: DistillSource;
  createdAt: string;
};

/** Private training example (not for public repo). */
export type DistillTrainingExample = DistillManifestEntry & {
  messages: DistillChatMessage[];
};

export type TrainSafetyResult = {
  ok: boolean;
  reasons: string[];
  suggestedPartition: DistillPartition;
};

const SHA256_RE = /^[a-f0-9]{64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const s = nonEmptyString(value, label);
  if (!SHA256_RE.test(s)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return s;
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

const PARTITIONS = new Set<DistillPartition>([
  "train",
  "dev",
  "holdout",
  "quarantine",
]);

const VERIFIED = new Set<DistillVerified>([
  "human-apply",
  "deterministic-agreement",
  "both",
]);

const SOURCES = new Set<DistillSource>([
  "corpus-snapshot",
  "apply-log",
  "manual",
]);

/**
 * Validate a git-safe manifest entry (metadata only).
 */
export function validateDistillManifestEntry(
  value: unknown,
): DistillManifestEntry {
  const root = record(value, "manifest entry");
  if (root.manifestVersion !== DISTILL_MANIFEST_VERSION) {
    throw new Error(
      `unsupported distill manifest version: ${String(root.manifestVersion)}`,
    );
  }
  const partition = nonEmptyString(root.partition, "partition");
  if (!PARTITIONS.has(partition as DistillPartition)) {
    throw new Error(
      `partition must be train|dev|holdout|quarantine, got ${partition}`,
    );
  }
  const verified = nonEmptyString(root.verified, "verified");
  if (!VERIFIED.has(verified as DistillVerified)) {
    throw new Error(
      `verified must be human-apply|deterministic-agreement|both, got ${verified}`,
    );
  }
  const source = nonEmptyString(root.source, "source");
  if (!SOURCES.has(source as DistillSource)) {
    throw new Error(
      `source must be corpus-snapshot|apply-log|manual, got ${source}`,
    );
  }
  const createdAt = nonEmptyString(root.createdAt, "createdAt");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("createdAt must be an ISO-8601 date string");
  }

  return {
    manifestVersion: 1,
    id: nonEmptyString(root.id, "id"),
    partition: partition as DistillPartition,
    brandCode: nonEmptyString(root.brandCode, "brandCode"),
    verified: verified as DistillVerified,
    schemaVersion: positiveInt(root.schemaVersion, "schemaVersion"),
    contentSha256: sha256(root.contentSha256, "contentSha256"),
    source: source as DistillSource,
    createdAt,
  };
}

/**
 * Validate a private training example (manifest + messages).
 * Does not run full train-safety (see assessTrainSafety).
 */
export function validateDistillTrainingExample(
  value: unknown,
): DistillTrainingExample {
  const entry = validateDistillManifestEntry(value);
  const root = record(value, "training example");
  if (!Array.isArray(root.messages) || root.messages.length < 2) {
    throw new Error("messages must be an array with at least system/user turns");
  }
  const messages: DistillChatMessage[] = root.messages.map((raw, i) => {
    const msg = record(raw, `messages[${i}]`);
    const role = nonEmptyString(msg.role, `messages[${i}].role`);
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Error(`messages[${i}].role must be system|user|assistant`);
    }
    return {
      role: role as DistillChatRole,
      content: nonEmptyString(msg.content, `messages[${i}].content`),
    };
  });

  const roles = messages.map((m) => m.role);
  if (!roles.includes("user")) {
    throw new Error("messages must include a user turn");
  }
  if (!roles.includes("assistant")) {
    throw new Error("messages must include an assistant turn");
  }

  return { ...entry, messages };
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Train-safety assessment for a private example.
 *
 * @param criticalFields - field names that must not be blank-poisoned when
 *   `goldNonBlankFields` marks them present in gold (optional hard checks).
 * @param goldNonBlankFields - critical fields known non-blank in gold labels.
 * @param options.nearDuplicateOfHoldout - caller already detected near-dup.
 * @param options.brandInOtherPartition - brand already used outside this partition.
 */
export function assessTrainSafety(
  example: DistillTrainingExample,
  options?: {
    criticalFields?: string[];
    goldNonBlankFields?: string[];
    nearDuplicateOfHoldout?: boolean;
    brandInOtherPartition?: boolean;
  },
): TrainSafetyResult {
  const reasons: string[] = [];
  const assistant = [...example.messages]
    .reverse()
    .find((m) => m.role === "assistant");

  if (!assistant) {
    reasons.push("missing assistant message");
  } else {
    const content = assistant.content.trim();
    if (content.startsWith("```") || content.includes("```json")) {
      reasons.push("assistant content contains markdown fences");
    }
    if (
      /here is the json|here's the json|as follows:/i.test(content.slice(0, 80))
    ) {
      reasons.push("assistant content has leading prose before JSON");
    }
    const obj = tryParseJsonObject(content);
    if (!obj) {
      reasons.push("assistant content is not a JSON object");
    } else if (options?.criticalFields?.length) {
      const gold = new Set(options.goldNonBlankFields ?? []);
      for (const field of options.criticalFields) {
        if (!gold.has(field)) continue;
        const v = obj[field];
        const blank =
          v === null ||
          v === undefined ||
          v === "" ||
          (typeof v === "string" && v.trim() === "");
        if (blank) {
          reasons.push(
            `blank-poison risk: critical field "${field}" is blank but gold is non-blank`,
          );
        }
      }
    }
  }

  if (
    example.verified !== "human-apply" &&
    example.verified !== "deterministic-agreement" &&
    example.verified !== "both"
  ) {
    reasons.push("unverified label");
  }

  if (options?.nearDuplicateOfHoldout) {
    reasons.push("near-duplicate of holdout/dev input");
  }
  if (options?.brandInOtherPartition) {
    reasons.push("brand already assigned to another partition");
  }

  const ok = reasons.length === 0;
  // Verified examples that fail structural checks go to quarantine, not train.
  const suggestedPartition: DistillPartition = ok
    ? example.partition === "quarantine"
      ? "train"
      : example.partition
    : "quarantine";

  return { ok, reasons, suggestedPartition };
}

/**
 * Ensure no brandCode appears in more than one of train/dev/holdout.
 * Quarantine is ignored for leakage purposes.
 */
export function assertBrandPartitionIntegrity(
  entries: DistillManifestEntry[],
): void {
  const map = new Map<string, DistillPartition>();
  for (const e of entries) {
    if (e.partition === "quarantine") continue;
    const prev = map.get(e.brandCode);
    if (prev && prev !== e.partition) {
      throw new Error(
        `brand partition leak: "${e.brandCode}" in both ${prev} and ${e.partition}`,
      );
    }
    map.set(e.brandCode, e.partition);
  }
}

/**
 * Build a git-safe manifest entry from a full training example
 * (strips messages).
 */
export function toManifestEntry(
  example: DistillTrainingExample,
): DistillManifestEntry {
  const {
    manifestVersion,
    id,
    partition,
    brandCode,
    verified,
    schemaVersion,
    contentSha256,
    source,
    createdAt,
  } = example;
  return {
    manifestVersion,
    id,
    partition,
    brandCode,
    verified,
    schemaVersion,
    contentSha256,
    source,
    createdAt,
  };
}

// Near-duplicate helpers (shingles + Jaccard)
export {
  DEFAULT_NEAR_DUP_CONFIG,
  findNearDuplicates,
  jaccard,
  jaccardTexts,
  normalizeForNearDup,
  shingleSet,
  trainNearDupFlags,
  type NearDupConfig,
  type NearDupHit,
  type ShingleMode,
  type TrainNearDupFlag,
} from "./nearDup.js";

