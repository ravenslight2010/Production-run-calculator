import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

export type Evidence = { file: string; contains?: string };
export type RecoveryEntry = {
  id: string;
  feature: string;
  files: string[];
  wiring?: Evidence[];
  contracts?: Evidence[];
  tests?: Evidence[];
  intentionalDifference?: string;
};
export type RecoveryManifest = { version: number; description?: string; entries: RecoveryEntry[] };
export type EvidenceResult = Evidence & { present: boolean; reason?: string };
export type EntryAudit = {
  id: string;
  feature: string;
  status: "pass" | "missing" | "intentional-difference";
  intentionalDifference?: string;
  files: EvidenceResult[];
  wiring: EvidenceResult[];
  contracts: EvidenceResult[];
  tests: EvidenceResult[];
  missing: string[];
};

async function checkEvidence(root: string, evidence: Evidence[]): Promise<EvidenceResult[]> {
  return Promise.all(evidence.map(async (item) => {
    const path = resolve(root, item.file);
    try {
      await access(path);
      if (item.contains === undefined) return { ...item, present: true };
      const content = await readFile(path, "utf8");
      return content.includes(item.contains)
        ? { ...item, present: true }
        : { ...item, present: false, reason: `does not contain ${JSON.stringify(item.contains)}` };
    } catch {
      return { ...item, present: false, reason: "file is missing or unreadable" };
    }
  }));
}

function labels(kind: string, results: EvidenceResult[]): string[] {
  return results.filter((result) => !result.present)
    .map((result) => `${kind}: ${result.file}${result.contains ? ` [${result.contains}]` : ""} (${result.reason})`);
}

export async function auditManifest(root: string, manifest: RecoveryManifest): Promise<EntryAudit[]> {
  const audits: EntryAudit[] = [];
  for (const entry of manifest.entries) {
    const files = await checkEvidence(root, entry.files.map((file) => ({ file })));
    const wiring = await checkEvidence(root, entry.wiring ?? []);
    const contracts = await checkEvidence(root, entry.contracts ?? []);
    const tests = await checkEvidence(root, entry.tests ?? []);
    const missing = [
      ...labels("file", files),
      ...labels("wiring", wiring),
      ...labels("contract", contracts),
      ...labels("test", tests),
    ];
    const status = missing.length === 0
      ? "pass"
      : entry.intentionalDifference
        ? "intentional-difference"
        : "missing";
    audits.push({
      id: entry.id,
      feature: entry.feature,
      status,
      ...(entry.intentionalDifference ? { intentionalDifference: entry.intentionalDifference } : {}),
      files,
      wiring,
      contracts,
      tests,
      missing,
    });
  }
  return audits;
}

export function formatAudit(audits: EntryAudit[], json = false): string {
  if (json) return JSON.stringify({ entries: audits, summary: summarizeAudit(audits) }, null, 2);
  const lines = ["Recovery evidence audit", "========================"];
  for (const audit of audits) {
    lines.push(`${audit.status === "pass" ? "PASS" : audit.status === "intentional-difference" ? "DIFFERENT" : "MISSING"} ${audit.id} — ${audit.feature}`);
    if (audit.status === "intentional-difference") lines.push(`  intentional difference: ${audit.intentionalDifference}`);
    for (const missing of audit.missing) lines.push(`  - ${missing}`);
  }
  const summary = summarizeAudit(audits);
  lines.push("", `Summary: ${summary.pass} pass, ${summary.intentionalDifference} intentional difference, ${summary.missing} missing`);
  return lines.join("\n");
}

export function summarizeAudit(audits: EntryAudit[]) {
  return audits.reduce((summary, audit) => {
    if (audit.status === "intentional-difference") summary.intentionalDifference++;
    else summary[audit.status]++;
    return summary;
  }, { pass: 0, missing: 0, intentionalDifference: 0 });
}

async function main() {
  const root = resolve(process.env.RECOVERY_AUDIT_ROOT ?? resolve(import.meta.dirname, "../.."));
  const manifestPath = resolve(process.env.RECOVERY_MANIFEST ?? resolve(root, "scripts/recovery-manifest.json"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RecoveryManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error(`Unsupported recovery manifest: ${manifestPath}`);
  }
  const audits = await auditManifest(root, manifest);
  console.log(formatAudit(audits, process.argv.includes("--json")));
  if (audits.some((audit) => audit.status === "missing")) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();