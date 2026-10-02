import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  NEAR_DUPLICATE_POLICY,
  assertBrandPartitionIntegrity,
  assertNoCrossPartitionContentDuplicates,
  assessTrainSafety,
  assignBrandPartitions,
  canonicalJson,
  redactPrivateCopy,
  sha256,
  trainNearDupFlags,
  validateRedactionConfig,
  verifyCandidate,
  type DistillCandidateInput,
  type DistillMessage,
  type DistillPartition,
  type RedactionConfig,
  type VerifiedCandidate,
} from "@workspace/distill-dataset";
import { SPEC_IMPORT_PARSE_VERSION } from "@workspace/spec-import";

export const EXPECTED_PRODUCTION_PROMPT_SHA256 =
  "65196b19789f6f1cc676c45f00e32b14c34320f869766e8f6c711a351e9f9d76";
const DEFAULT_DECISION_RELATIVE_PATH = "docs/evidence/distillation-backfill-decision-2026-10-02.json";
const MAX_EVIDENCE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_CANDIDATES = 5_000;
const MAX_CANDIDATE_LINE_BYTES = 1024 * 1024;
const REVIEW_FORMAT = "distill-quarantine-review";

type DecisionFile = {
  format: "distill-backfill-decision";
  version: 1;
  decision: "go" | "no-go";
  decisionDate: string;
  currentParseVersion: string;
  productionSystemPromptSha256: string;
  benchmark: { outcome: string; evidenceSha256: string };
  trainingEvaluation: { outcome: string; evidenceSha256: string };
  datasetSafety: { outcome: string; evidenceSha256: string };
  reasonCodes?: string[];
  approver?: { role: string; actorIdSha256: string; approvedAt: string };
};

type RunOptions = {
  repoRoot: string;
  source: "corpus" | "applylog" | "both";
  corpusEvidence?: string;
  applylogEvidence?: string;
  decision: string;
  out: string;
  manifest?: string;
  redactionConfig?: string;
  quarantineReview?: string;
  dryRun?: boolean;
  onlyQuarantine?: boolean;
  maxPerBrand?: number;
  strict?: boolean;
  understandSmallHoldout?: boolean;
};

type ProductionContract = {
  systemPrompt: string;
  systemPromptSha256: string;
  currentParseVersion: string;
};

type QuarantineRecord = {
  id: string;
  source: "corpus" | "applylog" | "unknown";
  brand?: string;
  reasons: string[];
  messages?: DistillMessage[];
  parseVersion?: string;
};

type PreparedCandidate = {
  candidate: VerifiedCandidate;
  messages: DistillMessage[];
  contentSha256: string;
  partition?: Exclude<DistillPartition, "quarantine">;
};

type BackfillReport = {
  format: "distill-backfill-report";
  version: 1;
  decision: "go";
  decisionSha256: string;
  productionSystemPromptSha256: string;
  parseVersion: string;
  redactionVersion: number;
  nearDuplicatePolicy: typeof NEAR_DUPLICATE_POLICY;
  counts: {
    totalCandidates: number;
    verifiedBeforeSafetyAndLeakage: number;
    accepted: number;
    quarantined: number;
  };
  byBrandCode: Record<string, { total: number; verified: number; quarantined: number }>;
  bySource: Record<string, { total: number; verified: number; quarantined: number }>;
  byVerificationPath: Record<string, number>;
  byQuarantineReason: Record<string, number>;
  warnings: string[];
  quarantineReportSha256: string;
};

export type RunResult = {
  exitCode: number;
  status: "blocked" | "dry-run" | "quarantine-only" | "awaiting-quarantine-review" | "emitted";
  report?: BackfillReport;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function ensureExistingPathOutsideRepository(filePath: string, repoRoot: string, label: string): string {
  if (!path.isAbsolute(filePath)) throw new Error(`${label} must be an absolute path outside the repository`);
  const actual = fs.realpathSync(filePath);
  const realRepo = fs.realpathSync(repoRoot);
  if (isWithin(realRepo, actual)) throw new Error(`${label} must be outside the repository`);
  return actual;
}

function resolveNewDirectoryOutsideRepository(directory: string, repoRoot: string): string {
  if (!path.isAbsolute(directory)) throw new Error("--out must be an absolute path outside the repository");
  const absolute = path.resolve(directory);
  const parent = fs.realpathSync(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (isWithin(fs.realpathSync(repoRoot), resolved)) {
    throw new Error("--out must be outside the repository");
  }
  if (fs.existsSync(resolved)) {
    if (!fs.statSync(resolved).isDirectory() || fs.readdirSync(resolved).length) {
      throw new Error("--out must be a new or empty private directory");
    }
  }
  return resolved;
}

function resolveManifestPath(filePath: string, repoRoot: string): string {
  if (!path.isAbsolute(filePath)) throw new Error("--manifest must resolve inside the repository");
  const absolute = path.resolve(filePath);
  const parent = fs.realpathSync(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (!isWithin(fs.realpathSync(repoRoot), resolved)) {
    throw new Error("--manifest must be inside the repository");
  }
  if (fs.existsSync(resolved)) throw new Error("--manifest already exists; choose a new metadata-only path");
  return resolved;
}

function readJson(pathName: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(pathName, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} could not be read as JSON: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function validateDecision(value: unknown): DecisionFile {
  if (!isRecord(value) || value.format !== "distill-backfill-decision" || value.version !== 1) {
    throw new Error("decision file must use distill-backfill-decision version 1");
  }
  if (value.decision !== "go" && value.decision !== "no-go") {
    throw new Error("decision file must explicitly say go or no-go");
  }
  if (
    typeof value.decisionDate !== "string"
    || typeof value.currentParseVersion !== "string"
    || !isSha256(value.productionSystemPromptSha256)
    || !isRecord(value.benchmark)
    || !isRecord(value.trainingEvaluation)
    || !isRecord(value.datasetSafety)
    || !isSha256(value.benchmark.evidenceSha256)
    || !isSha256(value.trainingEvaluation.evidenceSha256)
    || !isSha256(value.datasetSafety.evidenceSha256)
  ) {
    throw new Error("decision file is missing pinned evaluation and safety metadata");
  }
  return value as unknown as DecisionFile;
}

function validateGoDecision(
  decision: DecisionFile,
  contract: ProductionContract,
): string[] {
  const reasons: string[] = [];
  if (decision.benchmark.outcome !== "passed") reasons.push("benchmark_not_passed");
  if (decision.trainingEvaluation.outcome !== "go") reasons.push("training_evaluation_not_go");
  if (decision.datasetSafety.outcome !== "approved") reasons.push("dataset_safety_not_approved");
  if (decision.productionSystemPromptSha256 !== contract.systemPromptSha256) reasons.push("decision_prompt_pin_mismatch");
  if (decision.currentParseVersion !== contract.currentParseVersion) reasons.push("decision_parse_version_mismatch");
  const approver = decision.approver;
  if (
    !approver
    || approver.role !== "manager"
    || !isSha256(approver.actorIdSha256)
    || !isoDate(approver.approvedAt)
  ) reasons.push("missing_manager_approval");
  return reasons;
}

export function readCandidateJsonl(
  filePath: string,
  source: "corpus" | "applylog",
): Array<{
  source: "corpus" | "applylog";
  value?: unknown;
  rawHash: string;
  parseError?: boolean;
  oversized?: boolean;
}> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`evidence path for ${source} must be a file`);
  if (stat.size > MAX_EVIDENCE_FILE_BYTES) throw new Error(`${source} evidence exceeds the 100 MiB limit`);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_CANDIDATES) throw new Error(`${source} evidence exceeds the ${MAX_CANDIDATES} candidate limit`);
  return lines.map((line) => {
    const rawHash = sha256(line);
    if (Buffer.byteLength(line, "utf8") > MAX_CANDIDATE_LINE_BYTES) {
      return { source, rawHash, oversized: true };
    }
    try {
      return { source, value: JSON.parse(line) as unknown, rawHash };
    } catch {
      return { source, rawHash, parseError: true };
    }
  });
}

function quarantineFromRaw(
  id: string,
  source: "corpus" | "applylog" | "unknown",
  raw: unknown,
  reasons: string[],
  contract: ProductionContract,
  redaction: RedactionConfig,
): QuarantineRecord {
  const record: QuarantineRecord = { id, source, reasons };
  if (!isRecord(raw)) return record;
  if (typeof raw.brand === "string" && raw.brand.trim()) record.brand = raw.brand;
  if (typeof raw.parseVersion === "string") record.parseVersion = raw.parseVersion;
  if (typeof raw.userContent === "string" && typeof raw.assistantText === "string") {
    try {
      record.messages = [
        { role: "system", content: contract.systemPrompt },
        { role: "user", content: redactPrivateCopy(raw.userContent, redaction) },
        { role: "assistant", content: redactPrivateCopy(raw.assistantText, redaction) },
      ];
    } catch {
      // A malformed private record is represented by its hash and reason only.
    }
  }
  return record;
}

function buildReport(
  candidates: Array<{ id: string; source: string; brand?: string; verified: boolean; verificationPath?: string }>,
  quarantines: QuarantineRecord[],
  brandCodes: Map<string, string>,
  warnings: string[],
  decisionSha256: string,
  contract: ProductionContract,
  redaction: RedactionConfig,
  acceptedCount: number,
  quarantineReportSha256: string,
): BackfillReport {
  const byBrandCode: BackfillReport["byBrandCode"] = {};
  const bySource: BackfillReport["bySource"] = {};
  const byVerificationPath: Record<string, number> = {};
  const byQuarantineReason: Record<string, number> = {};
  for (const candidate of candidates) {
    const brandCode = candidate.brand ? brandCodes.get(candidate.brand) ?? "brand-unknown" : "brand-unknown";
    const brand = byBrandCode[brandCode] ?? { total: 0, verified: 0, quarantined: 0 };
    brand.total++;
    if (candidate.verified) brand.verified++;
    byBrandCode[brandCode] = brand;

    const source = bySource[candidate.source] ?? { total: 0, verified: 0, quarantined: 0 };
    source.total++;
    if (candidate.verified) source.verified++;
    bySource[candidate.source] = source;
    if (candidate.verificationPath) {
      byVerificationPath[candidate.verificationPath] = (byVerificationPath[candidate.verificationPath] ?? 0) + 1;
    }
  }
  for (const quarantine of quarantines) {
    const brandCode = quarantine.brand ? brandCodes.get(quarantine.brand) ?? "brand-unknown" : "brand-unknown";
    const brand = byBrandCode[brandCode] ?? { total: 0, verified: 0, quarantined: 0 };
    brand.quarantined++;
    byBrandCode[brandCode] = brand;

    const source = bySource[quarantine.source] ?? { total: 0, verified: 0, quarantined: 0 };
    source.quarantined++;
    bySource[quarantine.source] = source;
    for (const reason of new Set(quarantine.reasons)) {
      byQuarantineReason[reason] = (byQuarantineReason[reason] ?? 0) + 1;
    }
  }
  return {
    format: "distill-backfill-report",
    version: 1,
    decision: "go",
    decisionSha256,
    productionSystemPromptSha256: contract.systemPromptSha256,
    parseVersion: contract.currentParseVersion,
    redactionVersion: redaction.version,
    nearDuplicatePolicy: NEAR_DUPLICATE_POLICY,
    counts: {
      totalCandidates: candidates.length,
      verifiedBeforeSafetyAndLeakage: candidates.filter((candidate) => candidate.verified).length,
      accepted: acceptedCount,
      quarantined: quarantines.length,
    },
    byBrandCode: Object.fromEntries(Object.entries(byBrandCode).sort(([a], [b]) => a.localeCompare(b))),
    bySource: Object.fromEntries(Object.entries(bySource).sort(([a], [b]) => a.localeCompare(b))),
    byVerificationPath: Object.fromEntries(Object.entries(byVerificationPath).sort(([a], [b]) => a.localeCompare(b))),
    byQuarantineReason: Object.fromEntries(Object.entries(byQuarantineReason).sort(([a], [b]) => a.localeCompare(b))),
    warnings,
    quarantineReportSha256,
  };
}

function readAndValidateQuarantineReview(filePath: string, reportHash: string): boolean {
  const value = readJson(filePath, "quarantine review");
  if (!isRecord(value)) return false;
  return value.format === REVIEW_FORMAT
    && value.version === 1
    && value.quarantineReportSha256 === reportHash
    && value.decision === "exclude-quarantined"
    && value.reviewerCapability === "manage-profiles"
    && isSha256(value.reviewerIdSha256)
    && isoDate(value.reviewedAt);
}

function writePrivateRun(
  outPath: string,
  files: Record<string, string>,
): void {
  const parent = path.dirname(outPath);
  const stage = fs.mkdtempSync(path.join(parent, ".distill-backfill-stage-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
        throw new Error("invalid private output file name");
      }
      fs.writeFileSync(path.join(stage, name), content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
    if (fs.existsSync(outPath)) fs.rmdirSync(outPath);
    fs.renameSync(stage, outPath);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

function writeManifest(manifestPath: string, value: unknown): void {
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    fs.renameSync(temporary, manifestPath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function jsonl(records: unknown[]): string {
  return records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
}

function makeManifest(
  examples: PreparedCandidate[],
  brandCodes: Map<string, string>,
  report: BackfillReport,
  decision: DecisionFile,
): Record<string, unknown> {
  const entries = examples.map(({ candidate, contentSha256, partition }) => ({
    id: candidate.id,
    brandCode: brandCodes.get(candidate.brand) ?? "brand-unknown",
    partition,
    verified: candidate.verificationPath,
    source: candidate.source,
    sourceSha256: candidate.sourceSha256,
    sourceEvidenceSha256: candidate.sourceEvidenceSha256,
    contentSha256,
    parseVersion: candidate.parseVersion,
    redactionVersion: report.redactionVersion,
    ...(candidate.editDistance === undefined ? {} : { editDistance: candidate.editDistance }),
  }));
  return {
    format: "distill-dataset-manifest",
    version: 1,
    decisionSha256: report.decisionSha256,
    decisionDate: decision.decisionDate,
    productionSystemPromptSha256: report.productionSystemPromptSha256,
    parseVersion: report.parseVersion,
    nearDuplicatePolicy: report.nearDuplicatePolicy,
    counts: {
      train: examples.filter((example) => example.partition === "train").length,
      development: examples.filter((example) => example.partition === "development").length,
      holdout: examples.filter((example) => example.partition === "holdout").length,
      quarantine: report.counts.quarantined,
    },
    entries,
  };
}

export async function runBackfill(
  options: RunOptions,
  dependencies: {
    contract?: ProductionContract;
    loadContract?: (repoRoot: string) => Promise<ProductionContract>;
    output?: (message: string) => void;
  } = {},
): Promise<RunResult> {
  const output = dependencies.output ?? ((message: string) => console.log(message));
  const decisionPath = path.resolve(options.repoRoot, options.decision);
  if (!isWithin(fs.realpathSync(options.repoRoot), decisionPath)) {
    throw new Error("--decision must be a metadata-only file inside the repository");
  }
  const decision = validateDecision(readJson(decisionPath, "decision file"));
  const decisionSha256 = sha256(fs.readFileSync(decisionPath));
  if (decision.decision === "no-go") {
    const reasons = decision.reasonCodes?.length ? decision.reasonCodes : ["decision_recorded_no_go"];
    const message = JSON.stringify({
      status: "blocked",
      decision: "no-go",
      reasons,
      examplesEmitted: 0,
      candidateEvidenceRead: false,
    });
    output(message);
    return { exitCode: 2, status: "blocked", message };
  }

  const contract = dependencies.contract
    ?? await (dependencies.loadContract ?? loadProductionContract)(options.repoRoot);
  const authorizationErrors = validateGoDecision(decision, contract);
  if (authorizationErrors.length) {
    const message = JSON.stringify({
      status: "blocked",
      decision: "go",
      reasons: authorizationErrors,
      examplesEmitted: 0,
      candidateEvidenceRead: false,
    });
    output(message);
    return { exitCode: 2, status: "blocked", message };
  }

  const outPath = resolveNewDirectoryOutsideRepository(options.out, options.repoRoot);
  const selectedSources = options.source === "both" ? ["corpus", "applylog"] as const : [options.source] as const;
  const sourceFiles: Array<{ source: "corpus" | "applylog"; path: string }> = [];
  for (const source of selectedSources) {
    const file = source === "corpus" ? options.corpusEvidence : options.applylogEvidence;
    if (!file) throw new Error(`--${source === "corpus" ? "corpus" : "applylog"}-evidence is required for --source ${options.source}`);
    sourceFiles.push({
      source,
      path: ensureExistingPathOutsideRepository(file, options.repoRoot, `${source} evidence`),
    });
  }
  const manifestPath = options.manifest
    ? resolveManifestPath(options.manifest, options.repoRoot)
    : undefined;
  if (!options.dryRun && !options.onlyQuarantine && !manifestPath) {
    throw new Error("--manifest is required when emitting accepted train/dev/holdout data");
  }
  if (options.maxPerBrand !== undefined && (!Number.isInteger(options.maxPerBrand) || options.maxPerBrand < 1)) {
    throw new Error("--max-per-brand must be a positive integer");
  }
  const redactionPath = options.redactionConfig
    ? ensureExistingPathOutsideRepository(options.redactionConfig, options.repoRoot, "redaction config")
    : path.join(options.repoRoot, "lib/distill-dataset/redaction-rules.json");
  const redaction = validateRedactionConfig(readJson(redactionPath, "redaction config"));
  const candidates = sourceFiles.flatMap(({ source, path: file }) => readCandidateJsonl(file, source));
  if (candidates.length > MAX_CANDIDATES) {
    throw new Error(`selected evidence exceeds the ${MAX_CANDIDATES} candidate limit`);
  }

  const quarantine: QuarantineRecord[] = [];
  const candidateStatus: Array<{
    id: string;
    source: string;
    brand?: string;
    verified: boolean;
    verificationPath?: string;
  }> = [];
  const prepared: PreparedCandidate[] = [];
  for (const entry of candidates) {
    if (entry.oversized || entry.parseError) {
      const rejected: QuarantineRecord = {
        id: entry.rawHash,
        source: entry.source,
        reasons: [entry.oversized ? "candidate_record_exceeds_1_mib" : "invalid_jsonl_record"],
      };
      quarantine.push(rejected);
      candidateStatus.push({ id: rejected.id, source: entry.source, verified: false });
      continue;
    }
    const raw = entry.value;
    if (!isRecord(raw) || raw.source !== entry.source) {
      const id = sha256(canonicalJson(raw));
      const rejected = quarantineFromRaw(
        id,
        entry.source,
        raw,
        ["source_file_mismatch"],
        contract,
        redaction,
      );
      quarantine.push(rejected);
      candidateStatus.push({
        id,
        source: entry.source,
        ...(rejected.brand ? { brand: rejected.brand } : {}),
        verified: false,
      });
      continue;
    }
    const verification = verifyCandidate(raw, {
      systemPromptSha256: contract.systemPromptSha256,
      currentParseVersion: contract.currentParseVersion,
    });
    if (verification.state === "quarantine") {
      const rejected = quarantineFromRaw(
        verification.id,
        entry.source,
        raw,
        verification.reasons,
        contract,
        redaction,
      );
      quarantine.push(rejected);
      candidateStatus.push({
        id: verification.id,
        source: entry.source,
        ...(verification.brand ? { brand: verification.brand } : {}),
        verified: false,
      });
      continue;
    }

    const candidate = verification.candidate;
    candidateStatus.push({
      id: candidate.id,
      source: candidate.source,
      brand: candidate.brand,
      verified: true,
      verificationPath: candidate.verificationPath,
    });
    let messages: DistillMessage[];
    try {
      messages = [
        { role: "system", content: contract.systemPrompt },
        { role: "user", content: redactPrivateCopy(candidate.userContent, redaction) },
        { role: "assistant", content: redactPrivateCopy(candidate.assistantContent, redaction) },
      ];
    } catch {
      const rejected = quarantineFromRaw(
        candidate.id,
        candidate.source,
        raw,
        ["redaction_failed"],
        contract,
        redaction,
      );
      quarantine.push(rejected);
      continue;
    }
    const safety = assessTrainSafety(
      { messages, parseVersion: candidate.parseVersion },
      {
        criticalFields: candidate.criticalFields,
        goldValues: candidate.goldValues,
        expectedSystemPrompt: contract.systemPrompt,
        currentParseVersion: contract.currentParseVersion,
        sourceSha256: candidate.sourceSha256,
        sourceEvidenceSha256: candidate.sourceEvidenceSha256,
      },
    );
    if (!safety.safe) {
      quarantine.push({
        id: candidate.id,
        source: candidate.source,
        brand: candidate.brand,
        reasons: safety.reasons.map((reason) => `safety:${reason}`),
        messages,
        parseVersion: candidate.parseVersion,
      });
      continue;
    }
    prepared.push({
      candidate,
      messages,
      contentSha256: sha256(messages[1]!.content),
    });
  }

  const byBrand = new Map<string, PreparedCandidate[]>();
  for (const entry of prepared) {
    const group = byBrand.get(entry.candidate.brand) ?? [];
    group.push(entry);
    byBrand.set(entry.candidate.brand, group);
  }
  if (options.maxPerBrand !== undefined) {
    for (const [brand, group] of byBrand) {
      group.sort((left, right) => left.candidate.id.localeCompare(right.candidate.id));
      for (const excess of group.slice(options.maxPerBrand)) {
        quarantine.push({
          id: excess.candidate.id,
          source: excess.candidate.source,
          brand,
          reasons: ["max_per_brand_exceeded"],
          messages: excess.messages,
          parseVersion: excess.candidate.parseVersion,
        });
        prepared.splice(prepared.indexOf(excess), 1);
      }
    }
  }

  const brandSplit = assignBrandPartitions(prepared.map((entry) => entry.candidate.brand));
  const warnings = [...brandSplit.warnings];
  if (brandSplit.warnings.length && !options.understandSmallHoldout) {
    warnings.push("acknowledgment_required: pass --i-understand-small-holdout before partition output");
  }
  for (const entry of prepared) {
    entry.partition = brandSplit.partitions.get(entry.candidate.brand);
    if (!entry.partition) {
      quarantine.push({
        id: entry.candidate.id,
        source: entry.candidate.source,
        brand: entry.candidate.brand,
        reasons: ["brand_partition_missing"],
        messages: entry.messages,
        parseVersion: entry.candidate.parseVersion,
      });
    }
  }
  const activePrepared = prepared.filter((entry) => entry.partition);

  const exactGroups = new Map<string, PreparedCandidate[]>();
  for (const entry of activePrepared) {
    const group = exactGroups.get(entry.contentSha256) ?? [];
    group.push(entry);
    exactGroups.set(entry.contentSha256, group);
  }
  const exactRemoved = new Set<PreparedCandidate>();
  const rank: Record<Exclude<DistillPartition, "quarantine">, number> = {
    holdout: 0,
    development: 1,
    train: 2,
  };
  for (const group of exactGroups.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) =>
      rank[left.partition!] - rank[right.partition!]
      || left.candidate.id.localeCompare(right.candidate.id),
    );
    const keep = group[0]!;
    for (const duplicate of group.slice(1)) {
      exactRemoved.add(duplicate);
      quarantine.push({
        id: duplicate.candidate.id,
        source: duplicate.candidate.source,
        brand: duplicate.candidate.brand,
        reasons: [keep.partition === duplicate.partition
          ? "exact_duplicate_candidate"
          : "exact_cross_partition_duplicate"],
        messages: duplicate.messages,
        parseVersion: duplicate.candidate.parseVersion,
      });
    }
  }
  let uniquePrepared = activePrepared.filter((entry) => !exactRemoved.has(entry));
  assertBrandPartitionIntegrity(uniquePrepared.map((entry) => ({
    brand: entry.candidate.brand,
    partition: entry.partition!,
  })));
  assertNoCrossPartitionContentDuplicates(uniquePrepared.map((entry) => ({
    contentSha256: entry.contentSha256,
    partition: entry.partition!,
  })));

  const evaluation = uniquePrepared.filter((entry) =>
    entry.partition === "development" || entry.partition === "holdout",
  );
  const train = uniquePrepared.filter((entry) => entry.partition === "train");
  const nearDupFlags = trainNearDupFlags(
    train.map((entry) => ({ id: entry.candidate.id, text: entry.messages[1]!.content })),
    evaluation.map((entry) => ({ id: entry.candidate.id, text: entry.messages[1]!.content })),
  );
  const evalById = new Map(evaluation.map((entry) => [entry.candidate.id, entry]));
  const nearDupRemoved = new Set<PreparedCandidate>();
  for (const entry of train) {
    const match = nearDupFlags.get(entry.candidate.id);
    if (!match?.flag) continue;
    nearDupRemoved.add(entry);
    const matchingPartition = match.matchedId ? evalById.get(match.matchedId)?.partition : undefined;
    quarantine.push({
      id: entry.candidate.id,
      source: entry.candidate.source,
      brand: entry.candidate.brand,
      reasons: [`near_duplicate_against_${matchingPartition ?? "evaluation"}`],
      messages: entry.messages,
      parseVersion: entry.candidate.parseVersion,
    });
  }
  uniquePrepared = uniquePrepared.filter((entry) => !nearDupRemoved.has(entry));
  assertBrandPartitionIntegrity(uniquePrepared.map((entry) => ({
    brand: entry.candidate.brand,
    partition: entry.partition!,
  })));
  assertNoCrossPartitionContentDuplicates(uniquePrepared.map((entry) => ({
    contentSha256: entry.contentSha256,
    partition: entry.partition!,
  })));

  const allBrands = new Set<string>();
  for (const candidate of candidateStatus) if (candidate.brand) allBrands.add(candidate.brand);
  for (const candidate of quarantine) if (candidate.brand) allBrands.add(candidate.brand);
  const brandCodes = new Map([...allBrands].sort((a, b) => sha256(a).localeCompare(sha256(b)))
    .map((brand, index) => [brand, `brand-${String(index + 1).padStart(4, "0")}`]));
  const quarantineJsonl = jsonl(quarantine.map((record) => ({
    id: record.id,
    source: record.source,
    ...(record.brand ? { brandCode: brandCodes.get(record.brand) ?? "brand-unknown" } : {}),
    reasons: record.reasons,
    ...(record.parseVersion ? { parseVersion: record.parseVersion } : {}),
    ...(record.messages ? { messages: record.messages } : {}),
  })));
  const quarantineReportSha256 = sha256(quarantineJsonl);
  const report = buildReport(
    candidateStatus,
    quarantine,
    brandCodes,
    warnings,
    decisionSha256,
    contract,
    redaction,
    uniquePrepared.length,
    quarantineReportSha256,
  );
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;

  if (options.dryRun) {
    output(JSON.stringify(report));
    return { exitCode: options.strict && (warnings.length > 0 || quarantine.length > 0) ? 2 : 0, status: "dry-run", report, message: "dry-run complete; no output files written" };
  }

  const cannotSplit = brandSplit.warnings.length > 0 && !options.understandSmallHoldout;
  if (cannotSplit || options.onlyQuarantine || (options.strict && (warnings.length > 0 || quarantine.length > 0))) {
    writePrivateRun(outPath, {
      ...(quarantineJsonl ? { "quarantine.jsonl": quarantineJsonl } : {}),
      "report.json": reportJson,
    });
    if (cannotSplit) {
      return {
        exitCode: 2,
        status: "blocked",
        report,
        message: "small brand holdout acknowledgment is required; only the review report and quarantine were written",
      };
    }
    if (options.onlyQuarantine) {
      return { exitCode: options.strict && warnings.length ? 2 : 0, status: "quarantine-only", report, message: "wrote only the private quarantine review bundle" };
    }
    return {
      exitCode: 2,
      status: "blocked",
      report,
      message: "strict mode blocked accepted output; only the review report and quarantine were written",
    };
  }

  if (quarantine.length && !options.quarantineReview) {
    writePrivateRun(outPath, {
      ...(quarantineJsonl ? { "quarantine.jsonl": quarantineJsonl } : {}),
      "report.json": reportJson,
    });
    return {
      exitCode: 2,
      status: "awaiting-quarantine-review",
      report,
      message: `quarantine requires human review before data acceptance; report hash ${report.quarantineReportSha256}`,
    };
  }
  if (quarantine.length && options.quarantineReview) {
    const reviewPath = ensureExistingPathOutsideRepository(
      options.quarantineReview,
      options.repoRoot,
      "quarantine review receipt",
    );
    if (!readAndValidateQuarantineReview(reviewPath, report.quarantineReportSha256)) {
      writePrivateRun(outPath, {
        ...(quarantineJsonl ? { "quarantine.jsonl": quarantineJsonl } : {}),
        "report.json": reportJson,
      });
      return {
        exitCode: 2,
        status: "awaiting-quarantine-review",
        report,
        message: "quarantine review receipt is missing, invalid, or bound to a different report",
      };
    }
  }

  const finalManifestPath = manifestPath;
  if (!finalManifestPath) throw new Error("--manifest is required when emitting accepted train/dev/holdout data");
  const manifest = makeManifest(uniquePrepared, brandCodes, report, decision);
  const privateFiles: Record<string, string> = {
    "train.jsonl": jsonl(uniquePrepared.filter((entry) => entry.partition === "train")
      .map((entry) => ({ messages: entry.messages, parseVersion: entry.candidate.parseVersion }))),
    "development.jsonl": jsonl(uniquePrepared.filter((entry) => entry.partition === "development")
      .map((entry) => ({ messages: entry.messages, parseVersion: entry.candidate.parseVersion }))),
    "holdout.jsonl": jsonl(uniquePrepared.filter((entry) => entry.partition === "holdout")
      .map((entry) => ({ messages: entry.messages, parseVersion: entry.candidate.parseVersion }))),
    ...(quarantineJsonl ? { "quarantine.jsonl": quarantineJsonl } : {}),
    "report.json": reportJson,
  };
  writePrivateRun(outPath, privateFiles);
  try {
    writeManifest(finalManifestPath, manifest);
  } catch (error) {
    fs.rmSync(outPath, { recursive: true, force: true });
    throw error;
  }
  output(JSON.stringify(report));
  return { exitCode: 0, status: "emitted", report, message: "private train/dev/holdout files emitted and metadata-only manifest written" };
}

export async function loadProductionContract(repoRoot: string): Promise<ProductionContract> {
  const promptModulePath = path.join(repoRoot, "artifacts/api-server/src/routes/aiParseSpecSheet.ts");
  const promptModule = await import(pathToFileURL(promptModulePath).href) as {
    buildParseSpecSheetPrompt?: (input: { workbookText: string }) => { system: string };
  };
  if (typeof promptModule.buildParseSpecSheetPrompt !== "function") {
    throw new Error("production prompt builder is unavailable");
  }
  const systemPrompt = promptModule.buildParseSpecSheetPrompt({ workbookText: "" }).system;
  const systemPromptSha256 = sha256(systemPrompt);
  if (systemPromptSha256 !== EXPECTED_PRODUCTION_PROMPT_SHA256) {
    throw new Error(
      "production system prompt changed; refresh the reviewed benchmark/evaluation evidence before backfill",
    );
  }
  return { systemPrompt, systemPromptSha256, currentParseVersion: SPEC_IMPORT_PARSE_VERSION };
}

function parseArguments(args: string[], repoRoot: string): RunOptions {
  if (args[0] === "--") args = args.slice(1);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueFlags = new Set([
    "--source",
    "--corpus-evidence",
    "--applylog-evidence",
    "--decision",
    "--out",
    "--manifest",
    "--redaction-config",
    "--quarantine-review",
    "--max-per-brand",
    "--only",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected positional argument: ${arg}`);
    if (valueFlags.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values.set(arg, value);
      index++;
    } else if (["--dry-run", "--strict", "--i-understand-small-holdout"].includes(arg)) {
      flags.add(arg);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  const source = values.get("--source") ?? "both";
  if (source !== "corpus" && source !== "applylog" && source !== "both") {
    throw new Error("--source must be corpus, applylog, or both");
  }
  const only = values.get("--only");
  if (only !== undefined && only !== "quarantine") throw new Error("--only supports only quarantine");
  const maxPerBrandValue = values.get("--max-per-brand");
  const maxPerBrand = maxPerBrandValue === undefined ? undefined : Number(maxPerBrandValue);
  if (maxPerBrand !== undefined && (!Number.isInteger(maxPerBrand) || maxPerBrand < 1)) {
    throw new Error("--max-per-brand must be a positive integer");
  }
  const out = values.get("--out");
  if (!out) throw new Error("--out is required and must be outside the repository");
  return {
    repoRoot,
    source,
    ...(values.has("--corpus-evidence") ? { corpusEvidence: values.get("--corpus-evidence")! } : {}),
    ...(values.has("--applylog-evidence") ? { applylogEvidence: values.get("--applylog-evidence")! } : {}),
    decision: values.get("--decision") ?? DEFAULT_DECISION_RELATIVE_PATH,
    out,
    ...(values.has("--manifest") ? { manifest: values.get("--manifest")! } : {}),
    ...(values.has("--redaction-config") ? { redactionConfig: values.get("--redaction-config")! } : {}),
    ...(values.has("--quarantine-review") ? { quarantineReview: values.get("--quarantine-review")! } : {}),
    ...(maxPerBrand === undefined ? {} : { maxPerBrand }),
    dryRun: flags.has("--dry-run"),
    strict: flags.has("--strict"),
    onlyQuarantine: only === "quarantine",
    understandSmallHoldout: flags.has("--i-understand-small-holdout"),
  };
}

async function main(): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
  try {
    const result = await runBackfill(parseArguments(process.argv.slice(2), repoRoot));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "distillation backfill failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}