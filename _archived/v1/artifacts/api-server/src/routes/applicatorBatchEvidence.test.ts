import { describe, expect, it } from "vitest";
import {
  applicatorEvidenceHash,
  appendAutomaticApplicatorEvidence,
  canCreateInitialApplicatorFinal,
  classifyApplicatorSubmission,
  completedRunMatchesApplicatorFinal,
  correctionTargetsLatestApplicatorFinal,
  isValidApplicatorEvidenceDate,
  parseApplicatorBatchFinalization,
  serializeApplicatorEvidence,
} from "./applicatorBatchEvidence";
import applicatorBatchEvidenceRouter from "./applicatorBatchEvidence";
import { getRequiredCapabilities, isRequireManagerRole } from "../middlewares/requireCapability";
import { mutationAuthorizationInventory } from "./index";
import { getTableConfig } from "drizzle-orm/pg-core";
import { applicatorBatchEvidenceTable } from "@workspace/db";

describe("applicator evidence contract", () => {
  it("rejects impossible dates and unnecessary payload fields", () => {
    expect(isValidApplicatorEvidenceDate("2026-02-30")).toBe(false);
    expect(parseApplicatorBatchFinalization({
      operationId: "final-1", date: "2026-09-06", runId: "run-1", slot: 1, finalTotal: 4,
      recipe: "must-not-be-retained", customer: "must-not-be-retained",
    }).success).toBe(false);
  });

  it("hashes only the bounded evidence contract, not actor/device/recipe/customer payloads", () => {
    const base = {
      operationId: "final-1", date: "2026-09-06", runId: "run-1", slot: 1,
      source: "manager-finalization", confirmedTotal: 4,
    };
    expect(applicatorEvidenceHash(base)).toBe(applicatorEvidenceHash({
      ...base,
      actorId: "not-part-of-evidence",
      deviceId: "not-part-of-evidence",
      recipe: "not-part-of-evidence",
      customer: "not-part-of-evidence",
    } as typeof base));
  });

  it("serializes only evidence fields and omits actor/device/recipe/customer payloads", () => {
    const output = serializeApplicatorEvidence({
      id: "evidence-1", scope: "live", operationId: "final-1", date: "2026-09-06",
      runId: "run-1", slot: 1, source: "manager-finalization",
      observedTotal: null, confirmedTotal: 4, correctionOf: null,
      evidenceHash: "a".repeat(64), hashContract: "canonical-json-v1",
      createdAt: new Date("2026-09-06T12:00:00.000Z"),
    });
    expect(output).toEqual(expect.objectContaining({
      operationId: "final-1", confirmedTotal: 4, evidenceHash: "a".repeat(64),
    }));
    expect(output).not.toHaveProperty("scope");
    expect(output).not.toHaveProperty("actorId");
    expect(output).not.toHaveProperty("deviceId");
    expect(output).not.toHaveProperty("recipe");
    expect(output).not.toHaveProperty("customer");
  });

  it("models immutable first finalization, exact retry, and conflicting retry", () => {
    const hash = "a".repeat(64);
    expect(canCreateInitialApplicatorFinal(undefined)).toBe(true);
    expect(canCreateInitialApplicatorFinal("final-1")).toBe(false);
    expect(classifyApplicatorSubmission(undefined, hash)).toBe("new");
    expect(classifyApplicatorSubmission(hash, hash)).toBe("duplicate");
    expect(classifyApplicatorSubmission(hash, "b".repeat(64))).toBe("conflict");
  });

  it("only permits a correction of the latest manager chain head", () => {
    expect(correctionTargetsLatestApplicatorFinal("final-2", "final-2")).toBe(true);
    expect(correctionTargetsLatestApplicatorFinal("final-2", "final-1")).toBe(false);
    expect(correctionTargetsLatestApplicatorFinal(undefined, "final-1")).toBe(false);
  });

  it("fences concurrent initial finals and correction branches in the database", () => {
    const indexNames = getTableConfig(applicatorBatchEvidenceTable).indexes.map((index) => index.config.name);
    expect(indexNames).toContain("applicator_batch_evidence_scope_final_head_idx");
    expect(indexNames).toContain("applicator_batch_evidence_scope_correction_edge_idx");
  });

  it("requires a completed-history row in the same scope/date/run", () => {
    expect(completedRunMatchesApplicatorFinal(
      { scope: "live", date: "2026-09-06", runId: "run-1" }, "live", "2026-09-06", "run-1",
    )).toBe(true);
    expect(completedRunMatchesApplicatorFinal(
      undefined, "live", "2026-09-06", "run-1",
    )).toBe(false);
    expect(completedRunMatchesApplicatorFinal(
      { scope: "sandbox", date: "2026-09-06", runId: "run-1" }, "live", "2026-09-06", "run-1",
    )).toBe(false);
    expect(completedRunMatchesApplicatorFinal(
      { scope: "live", date: "2026-09-05", runId: "run-1" }, "live", "2026-09-06", "run-1",
    )).toBe(false);
  });

  it("uses a stable automatic operation key and database conflict fence", async () => {
    const inserts: Array<{ operationId: string; observedTotal: number }> = [];
    const tx = {
      insert: () => ({
        values: (value: { operationId: string; observedTotal: number }) => {
          inserts.push(value);
          return { onConflictDoNothing: async () => undefined };
        },
      }),
    };
    await appendAutomaticApplicatorEvidence(tx, {
      scope: "live", date: "2026-09-06", runId: "run-1", slot: 1, observedTotal: 3, eventId: "event-1",
    });
    await appendAutomaticApplicatorEvidence(tx, {
      scope: "live", date: "2026-09-06", runId: "run-1", slot: 1, observedTotal: 3, eventId: "event-1",
    });
    expect(inserts[0].operationId).toMatch(/^auto:[a-f0-9]{64}$/);
    expect(inserts[1].operationId).toBe(inserts[0].operationId);
    expect(inserts[0].observedTotal).toBe(3);
  });

  it("declares manager-only authorization for the finalization contract", () => {
    expect(mutationAuthorizationInventory).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/applicator-batch-evidence/finalize",
      ownership: "manager-only",
      scope: "scoped",
      capabilities: ["review-incidents"],
      managerRole: true,
    }));
    const layer = (applicatorBatchEvidenceRouter as any).stack.find(
      (candidate: any) => candidate.route?.path === "/applicator-batch-evidence/finalize",
    );
    expect(layer).toBeTruthy();
    expect(layer.route.stack.some(({ handle }: any) => isRequireManagerRole(handle))).toBe(true);
    expect(layer.route.stack.map(({ handle }: any) => getRequiredCapabilities(handle))
      .filter(Boolean)).toEqual([["review-incidents"]]);
  });
});