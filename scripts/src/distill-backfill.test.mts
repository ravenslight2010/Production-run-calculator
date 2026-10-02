import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBackfill } from "./distill-backfill.mts";
import {
  hashCriticalGoldEvidence,
  hashHumanApplyRecord,
  sha256,
} from "@workspace/distill-dataset";

const systemPrompt = "Synthetic pinned production prompt";
const contract = {
  systemPrompt,
  systemPromptSha256: sha256(systemPrompt),
  currentParseVersion: "41",
};
const digest = "a".repeat(64);

function makeDecision(decision: "go" | "no-go") {
  return {
    format: "distill-backfill-decision",
    version: 1,
    decision,
    decisionDate: "2026-10-02",
    currentParseVersion: "41",
    productionSystemPromptSha256: contract.systemPromptSha256,
    benchmark: { outcome: decision === "go" ? "passed" : "inconclusive", evidenceSha256: digest },
    trainingEvaluation: { outcome: decision === "go" ? "go" : "no-go", evidenceSha256: digest },
    datasetSafety: { outcome: decision === "go" ? "approved" : "no-go", evidenceSha256: digest },
    ...(decision === "go" ? {
      approver: {
        role: "manager",
        actorIdSha256: "b".repeat(64),
        approvedAt: "2026-10-02T12:00:00.000Z",
      },
    } : { reasonCodes: ["test_no_go"] }),
  };
}

function makeCandidate(brand: string, index: number, mismatch = false) {
  const sourceText = `Brand\t${brand}\nCase Pack\t12\nNotes\tSynthetic Supplier 42\nLine\t${index}`;
  const values = { profile: { brand, pizzasPerCase: 12 } };
  const assistantValues = mismatch
    ? { profile: { brand, pizzasPerCase: 10 } }
    : values;
  const goldValues = { "profile.brand": brand, "profile.pizzasPerCase": 12 };
  return {
    source: "corpus",
    brand,
    sourceText,
    userContent: `Parse this private extract:\n${sourceText}`,
    assistantText: JSON.stringify(assistantValues),
    criticalFields: ["profile.brand", "profile.pizzasPerCase"],
    parseVersion: "41",
    systemPromptSha256: contract.systemPromptSha256,
    goldValues,
    deterministicValues: values,
    goldEvidence: {
      kind: "independent-human-gold",
      reviewerCapability: "review-spec-gold",
      sourceSha256: sha256(sourceText),
      reviewerIdSha256: "c".repeat(64),
      reviewedAt: "2026-10-02T12:00:00.000Z",
      fieldPaths: ["profile.brand", "profile.pizzasPerCase"],
      goldValuesSha256: hashCriticalGoldEvidence({
        sourceSha256: sha256(sourceText),
        criticalFields: ["profile.brand", "profile.pizzasPerCase"],
        goldValues,
      }),
    },
  };
}

function makeApplyCandidate(brand: string, index: number) {
  const sourceText = `Brand\t${brand}\nCase Pack\t12\nApply row\t${index}`;
  const humanApply = {
    operationId: `op_${String(index).padStart(16, "0")}`,
    scope: "live" as const,
    status: "applied" as const,
    actorCapability: "manage-profiles",
    actorIdSha256: "c".repeat(64),
    appliedAt: "2026-10-02T12:00:00.000Z",
    sourceSha256: sha256(sourceText),
    appliedValues: { profile: { brand, pizzasPerCase: 12 } },
  };
  return {
    source: "applylog",
    brand,
    sourceText,
    userContent: `Parse this reviewed source:\n${sourceText}`,
    assistantText: JSON.stringify({ profile: { brand, pizzasPerCase: 10 } }),
    criticalFields: ["profile.brand", "profile.pizzasPerCase"],
    parseVersion: "41",
    systemPromptSha256: contract.systemPromptSha256,
    humanApply: {
      ...humanApply,
      recordSha256: hashHumanApplyRecord(humanApply),
    },
  };
}

function writeJsonl(filePath: string, records: unknown[]) {
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
}

function makeOptions({
  repoRoot,
  decisionPath,
  evidencePath,
  out,
  manifest,
  redactionPath,
  understandSmallHoldout = false,
  quarantineReview,
  source = "corpus",
  corpusEvidencePath,
  applylogEvidencePath,
  dryRun = false,
  strict = false,
  onlyQuarantine = false,
  maxPerBrand,
}: {
  repoRoot: string;
  decisionPath: string;
  evidencePath: string;
  out: string;
  manifest: string;
  redactionPath: string;
  understandSmallHoldout?: boolean;
  quarantineReview?: string;
  source?: "corpus" | "applylog" | "both";
  corpusEvidencePath?: string;
  applylogEvidencePath?: string;
  dryRun?: boolean;
  strict?: boolean;
  onlyQuarantine?: boolean;
  maxPerBrand?: number;
}) {
  return {
    repoRoot,
    source,
    ...(source !== "applylog" ? { corpusEvidence: corpusEvidencePath ?? evidencePath } : {}),
    ...(source !== "corpus" ? { applylogEvidence: applylogEvidencePath ?? evidencePath } : {}),
    decision: decisionPath,
    out,
    manifest,
    redactionConfig: redactionPath,
    ...(quarantineReview ? { quarantineReview } : {}),
    ...(maxPerBrand === undefined ? {} : { maxPerBrand }),
    dryRun,
    strict,
    onlyQuarantine,
    understandSmallHoldout,
  } as const;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "distill-backfill-test-"));
const repoRoot = path.join(tempRoot, "repo");
const privateRoot = path.join(tempRoot, "private");
fs.mkdirSync(path.join(repoRoot, "docs", "evidence"), { recursive: true });
fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
const decisionPath = path.join(repoRoot, "docs", "evidence", "decision.json");
const redactionPath = path.join(privateRoot, "redaction.json");
const evidencePath = path.join(privateRoot, "corpus.jsonl");
const systemPromptSentToOutput: string[] = [];
const dependencies = {
  contract,
  output: (message: string) => systemPromptSentToOutput.push(message),
};
const redaction = {
  version: 1,
  replacement: "[REDACTED]",
  sensitiveHeaders: ["supplier", "unit price"],
  literalValues: ["Synthetic Supplier 42"],
};
fs.writeFileSync(redactionPath, JSON.stringify(redaction), { mode: 0o600 });

try {
  fs.writeFileSync(decisionPath, JSON.stringify(makeDecision("no-go")));
  const missingEvidencePath = path.join(privateRoot, "must-not-be-read.jsonl");
  const noGoOut = path.join(privateRoot, "no-go-out");
  const noGo = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: missingEvidencePath,
    out: noGoOut,
    manifest: path.join(repoRoot, "docs", "evidence", "no-go-manifest.json"),
    redactionPath,
  }), dependencies);
  assert.equal(noGo.status, "blocked");
  assert.equal(noGo.exitCode, 2);
  assert.match(noGo.message, /candidateEvidenceRead":false/u);
  assert.equal(fs.existsSync(missingEvidencePath), false);
  assert.equal(fs.existsSync(noGoOut), false);

  fs.writeFileSync(decisionPath, JSON.stringify(makeDecision("go")));
  const records = [
    ...Array.from({ length: 7 }, (_, index) => makeCandidate(`Brand ${index}`, index)),
    makeCandidate("Brand 0", 99, true),
  ];
  writeJsonl(evidencePath, records);

  const firstOutput = path.join(privateRoot, "quarantine-review-stage");
  const firstRun = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: firstOutput,
    manifest: path.join(repoRoot, "docs", "evidence", "first-manifest.json"),
    redactionPath,
  }), dependencies);
  assert.equal(firstRun.status, "awaiting-quarantine-review");
  assert.equal(firstRun.exitCode, 2);
  assert.ok(firstRun.report);
  assert.equal(firstRun.report?.counts.accepted, 7);
  assert.equal(firstRun.report?.counts.quarantined, 1);
  assert.ok(firstRun.report?.byQuarantineReason["assistant_mismatch:profile.pizzasPerCase"]);
  assert.equal(fs.existsSync(path.join(firstOutput, "train.jsonl")), false);
  const quarantineText = fs.readFileSync(path.join(firstOutput, "quarantine.jsonl"), "utf8");
  assert.match(quarantineText, /assistant_mismatch:profile\.pizzasPerCase/u);
  assert.doesNotMatch(quarantineText, /Production system prompt/u);
  assert.equal(firstRun.report?.quarantineReportSha256, sha256(quarantineText));

  const alternateRedactionPath = path.join(privateRoot, "alternate-redaction.json");
  fs.writeFileSync(alternateRedactionPath, JSON.stringify({
    ...redaction,
    replacement: "[MASKED]",
  }), { mode: 0o600 });
  const alternateQuarantineRun = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: path.join(privateRoot, "alternate-quarantine"),
    manifest: path.join(repoRoot, "docs", "evidence", "alternate-quarantine-manifest.json"),
    redactionPath: alternateRedactionPath,
  }), dependencies);
  assert.notEqual(alternateQuarantineRun.report?.quarantineReportSha256, firstRun.report?.quarantineReportSha256);

  const reviewPath = path.join(privateRoot, "review.json");
  fs.writeFileSync(reviewPath, JSON.stringify({
    format: "distill-quarantine-review",
    version: 1,
    quarantineReportSha256: firstRun.report!.quarantineReportSha256,
    decision: "exclude-quarantined",
    reviewerCapability: "manage-profiles",
    reviewerIdSha256: "d".repeat(64),
    reviewedAt: "2026-10-02T13:00:00.000Z",
  }), { mode: 0o600 });
  const manifestPath = path.join(repoRoot, "docs", "evidence", "accepted-manifest.json");
  const acceptedOut = path.join(privateRoot, "accepted");
  const accepted = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: acceptedOut,
    manifest: manifestPath,
    redactionPath,
    quarantineReview: reviewPath,
  }), dependencies);
  assert.equal(accepted.status, "emitted");
  assert.equal(accepted.exitCode, 0);
  const train = fs.readFileSync(path.join(acceptedOut, "train.jsonl"), "utf8").trim().split("\n");
  const development = fs.readFileSync(path.join(acceptedOut, "development.jsonl"), "utf8").trim().split("\n");
  const holdout = fs.readFileSync(path.join(acceptedOut, "holdout.jsonl"), "utf8").trim().split("\n");
  assert.equal(train.length, 5);
  assert.equal(development.length, 1);
  assert.equal(holdout.length, 1);
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  assert.doesNotMatch(manifestText, /Brand 0|Synthetic pinned production prompt|private extract/u);
  assert.match(manifestText, /"sourceSha256"/u);

  const dryRunOut = path.join(privateRoot, "dry-run");
  const dryRun = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: dryRunOut,
    manifest: path.join(repoRoot, "docs", "evidence", "dry-run-manifest.json"),
    redactionPath,
    dryRun: true,
    quarantineReview: reviewPath,
  }), dependencies);
  assert.equal(dryRun.status, "dry-run");
  assert.equal(fs.existsSync(dryRunOut), false);

  const smallEvidencePath = path.join(privateRoot, "small-corpus.jsonl");
  writeJsonl(smallEvidencePath, Array.from({ length: 6 }, (_, index) => makeCandidate(`Small ${index}`, index)));
  const smallOut = path.join(privateRoot, "small-without-ack");
  const smallNoAck = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: smallEvidencePath,
    out: smallOut,
    manifest: path.join(repoRoot, "docs", "evidence", "small-manifest.json"),
    redactionPath,
  }), dependencies);
  assert.equal(smallNoAck.status, "blocked");
  assert.equal(fs.existsSync(path.join(smallOut, "train.jsonl")), false);
  assert.ok(smallNoAck.report?.warnings.some((warning) => warning.includes("acknowledgment_required")));

  const acknowledgedOut = path.join(privateRoot, "small-with-ack");
  const acknowledged = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: smallEvidencePath,
    out: acknowledgedOut,
    manifest: path.join(repoRoot, "docs", "evidence", "small-ack-manifest.json"),
    redactionPath,
    understandSmallHoldout: true,
  }), dependencies);
  assert.equal(acknowledged.status, "emitted");

  const strictOut = path.join(privateRoot, "strict");
  const strict = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: smallEvidencePath,
    out: strictOut,
    manifest: path.join(repoRoot, "docs", "evidence", "strict-manifest.json"),
    redactionPath,
    understandSmallHoldout: true,
    strict: true,
  }), dependencies);
  assert.equal(strict.status, "blocked");
  assert.equal(fs.existsSync(path.join(strictOut, "train.jsonl")), false);

  const quarantineOnlyOut = path.join(privateRoot, "quarantine-only");
  const quarantineOnlyEvidence = path.join(privateRoot, "quarantine-only.jsonl");
  writeJsonl(quarantineOnlyEvidence, [
    ...Array.from({ length: 6 }, (_, index) => makeCandidate(`Quarantine Brand ${index}`, index)),
    makeCandidate("Quarantine Brand 0", 99, true),
  ]);
  const quarantineOnly = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: quarantineOnlyEvidence,
    out: quarantineOnlyOut,
    manifest: path.join(repoRoot, "docs", "evidence", "quarantine-only-manifest.json"),
    redactionPath,
    onlyQuarantine: true,
    understandSmallHoldout: true,
  }), dependencies);
  assert.equal(quarantineOnly.status, "quarantine-only");
  assert.equal(quarantineOnly.report?.counts.quarantined, 1);
  assert.equal(fs.existsSync(path.join(quarantineOnlyOut, "train.jsonl")), false);
  assert.ok(fs.existsSync(path.join(quarantineOnlyOut, "quarantine.jsonl")));
  assert.equal(fs.existsSync(path.join(repoRoot, "docs", "evidence", "quarantine-only-manifest.json")), false);

  const combinedCorpusPath = path.join(privateRoot, "combined-corpus.jsonl");
  const combinedApplyPath = path.join(privateRoot, "combined-applylog.jsonl");
  writeJsonl(combinedCorpusPath, Array.from({ length: 7 }, (_, index) =>
    makeCandidate(`Combined Corpus ${index}`, index),
  ));
  writeJsonl(combinedApplyPath, Array.from({ length: 7 }, (_, index) =>
    makeApplyCandidate(`Combined Apply ${index}`, index + 100),
  ));
  const bothRun = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: combinedCorpusPath,
    corpusEvidencePath: combinedCorpusPath,
    applylogEvidencePath: combinedApplyPath,
    out: path.join(privateRoot, "both-sources"),
    manifest: path.join(repoRoot, "docs", "evidence", "both-sources-manifest.json"),
    redactionPath,
    source: "both",
  }), dependencies);
  assert.equal(bothRun.status, "emitted");
  assert.equal(bothRun.report?.bySource.corpus?.total, 7);
  assert.equal(bothRun.report?.bySource.applylog?.total, 7);
  assert.equal(bothRun.report?.byVerificationPath["deterministic-agreement"], 7);
  assert.equal(bothRun.report?.byVerificationPath["human-apply"], 7);

  const cappedEvidencePath = path.join(privateRoot, "capped.jsonl");
  writeJsonl(cappedEvidencePath, [
    ...Array.from({ length: 7 }, (_, index) => makeCandidate(`Capped Brand ${index}`, index)),
    makeCandidate("Capped Brand 0", 99),
  ]);
  const cappedOut = path.join(privateRoot, "capped");
  const capped = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: cappedEvidencePath,
    out: cappedOut,
    manifest: path.join(repoRoot, "docs", "evidence", "capped-manifest.json"),
    redactionPath,
    maxPerBrand: 1,
  }), dependencies);
  assert.equal(capped.status, "awaiting-quarantine-review");
  assert.equal(capped.report?.byQuarantineReason.max_per_brand_exceeded, 1);
  assert.equal(fs.existsSync(path.join(cappedOut, "train.jsonl")), false);

  const applyEvidencePath = path.join(privateRoot, "applylog.jsonl");
  writeJsonl(applyEvidencePath, Array.from({ length: 7 }, (_, index) =>
    makeApplyCandidate(`Apply Brand ${index}`, index + 1),
  ));
  const applyOut = path.join(privateRoot, "applylog-accepted");
  const applyManifest = path.join(repoRoot, "docs", "evidence", "applylog-manifest.json");
  const applyRun = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath: applyEvidencePath,
    out: applyOut,
    manifest: applyManifest,
    redactionPath,
    source: "applylog",
  }), dependencies);
  assert.equal(applyRun.status, "emitted");
  const applyManifestJson = JSON.parse(fs.readFileSync(applyManifest, "utf8")) as {
    entries: Array<{ verified: string; editDistance?: number }>;
  };
  assert.ok(applyManifestJson.entries.every((entry) => entry.verified === "human-apply"));
  assert.ok(applyManifestJson.entries.every((entry) => (entry.editDistance ?? 0) > 0));
  const applyTrainingRows = [
    ...fs.readFileSync(path.join(applyOut, "train.jsonl"), "utf8").trim().split("\n"),
    ...fs.readFileSync(path.join(applyOut, "development.jsonl"), "utf8").trim().split("\n"),
    ...fs.readFileSync(path.join(applyOut, "holdout.jsonl"), "utf8").trim().split("\n"),
  ].map((line) => JSON.parse(line) as { messages: Array<{ role: string; content: string }> });
  assert.equal(applyTrainingRows.length, 7);
  assert.ok(applyTrainingRows.every((row) => row.messages[2]?.content.includes('"pizzasPerCase":12')));

  const wrongReviewPath = path.join(privateRoot, "wrong-review.json");
  fs.writeFileSync(wrongReviewPath, JSON.stringify({
    format: "distill-quarantine-review",
    version: 1,
    quarantineReportSha256: "e".repeat(64),
    decision: "exclude-quarantined",
    reviewerCapability: "manage-profiles",
    reviewerIdSha256: "f".repeat(64),
    reviewedAt: "2026-10-02T13:00:00.000Z",
  }));
  const mismatchOut = path.join(privateRoot, "wrong-review");
  const wrongReview = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: mismatchOut,
    manifest: path.join(repoRoot, "docs", "evidence", "wrong-review-manifest.json"),
    redactionPath,
    quarantineReview: wrongReviewPath,
  }), dependencies);
  assert.equal(wrongReview.status, "awaiting-quarantine-review");
  assert.equal(fs.existsSync(path.join(mismatchOut, "train.jsonl")), false);

  const mismatchedPromptDecision = {
    ...makeDecision("go"),
    productionSystemPromptSha256: "f".repeat(64),
  };
  fs.writeFileSync(decisionPath, JSON.stringify(mismatchedPromptDecision));
  const mismatchDecisionOut = path.join(privateRoot, "prompt-mismatch");
  const mismatchDecision = await runBackfill(makeOptions({
    repoRoot,
    decisionPath,
    evidencePath,
    out: mismatchDecisionOut,
    manifest: path.join(repoRoot, "docs", "evidence", "prompt-mismatch-manifest.json"),
    redactionPath,
  }), dependencies);
  assert.equal(mismatchDecision.status, "blocked");
  assert.equal(fs.existsSync(evidencePath), true);
  assert.equal(fs.existsSync(mismatchDecisionOut), false);
  assert.ok(systemPromptSentToOutput.length > 0);
  console.log("Distillation backfill CLI tests passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}