import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "declaration-contract-test-"));
const baseline = path.join(root, "baseline");
const candidate = path.join(root, "candidate");
const report = path.join(root, "report");
const script = new URL("./compare-declaration-contracts.mts", import.meta.url);

function write(tree: string, file: string, content: string): void {
  const target = path.join(tree, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function run(extra: string[] = []) {
  return spawnSync(process.execPath, ["--import", "tsx", script.pathname, baseline, candidate, report, ...extra], {
    encoding: "utf8",
  });
}

try {
  write(baseline, "lib/api-client-react/dist/api.d.ts", 'export type State = "ready";\n');
  write(candidate, "lib/api-client-react/dist/api.d.ts", "export type State = 'ready';\n");
  write(baseline, "lib/api-zod/dist/api.d.ts", "export type Count = number;\n");
  write(candidate, "lib/api-zod/dist/api.d.ts", "export type Count = string;\n");
  write(baseline, "lib/db/dist/schema.d.ts", "export type Id = number;\n");
  write(candidate, "lib/db/dist/schema.d.ts", "export type Id = number;\n");
  write(baseline, "lib/db/dist/module.d.mts", "export type ModuleId = number;\n");
  write(candidate, "lib/db/dist/module.d.mts", "export type ModuleId = string;\n");
  write(baseline, "lib/db/dist/legacy.d.cts", "export type LegacyId = number;\n");

  const blocked = run();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /3 unexplained semantic declaration change/);
  const blockedReport = JSON.parse(fs.readFileSync(path.join(report, "declaration-contracts.json"), "utf8"));
  assert.equal(blockedReport.categories[0].formattingOnly, 1);
  assert.equal(blockedReport.categories[1].unexplainedSemantic, 1);
  assert.equal(blockedReport.categories[2].unexplainedSemantic, 2);

  const baselineText = fs.readFileSync(path.join(baseline, "lib/api-zod/dist/api.d.ts"), "utf8");
  const candidateText = fs.readFileSync(path.join(candidate, "lib/api-zod/dist/api.d.ts"), "utf8");
  const crypto = await import("node:crypto");
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
  const approvals = path.join(root, "approvals.json");
  fs.writeFileSync(
    approvals,
    JSON.stringify({
      schemaVersion: 1,
      approvals: [{
        path: "lib/api-zod/dist/api.d.ts",
        baselineSha256: digest(baselineText),
        candidateSha256: digest(candidateText),
        reason: "Reviewed fixture change.",
      }, {
        path: "lib/db/dist/module.d.mts",
        baselineSha256: digest("export type ModuleId = number;\n"),
        candidateSha256: digest("export type ModuleId = string;\n"),
        reason: "Reviewed module fixture change.",
      }, {
        path: "lib/db/dist/legacy.d.cts",
        baselineSha256: digest("export type LegacyId = number;\n"),
        candidateSha256: null,
        reason: "Reviewed fixture removal.",
      }],
    }),
  );
  const approved = run(["--approvals", approvals]);
  assert.equal(approved.status, 0, approved.stderr);

  const validApprovals = JSON.parse(fs.readFileSync(approvals, "utf8"));
  validApprovals.approvals.push({
    path: "lib/db/dist/unchanged.d.ts",
    baselineSha256: digest("unchanged"),
    candidateSha256: digest("unchanged"),
    reason: "Stale fixture approval.",
  });
  fs.writeFileSync(approvals, JSON.stringify(validApprovals));
  const staleApproval = run(["--approvals", approvals]);
  assert.notEqual(staleApproval.status, 0);
  assert.match(staleApproval.stderr, /Unused or stale semantic approval/);

  const extraArgument = run(["unexpected"]);
  assert.notEqual(extraArgument.status, 0);
  assert.match(extraArgument.stderr, /Usage:/);

  const repositoryReport = spawnSync(
    process.execPath,
    ["--import", "tsx", script.pathname, baseline, candidate, path.join(process.cwd(), "report")],
    { encoding: "utf8" },
  );
  assert.notEqual(repositoryReport.status, 0);
  assert.match(repositoryReport.stderr, /outside the repository/);

  const overlap = spawnSync(
    process.execPath,
    ["--import", "tsx", script.pathname, baseline, candidate, baseline],
    { encoding: "utf8" },
  );
  assert.notEqual(overlap.status, 0);
  assert.match(overlap.stderr, /must not overlap/);

  const repositoryLink = path.join(root, "repository-link");
  fs.symlinkSync(process.cwd(), repositoryLink, "dir");
  const symlinkEscape = spawnSync(
    process.execPath,
    ["--import", "tsx", script.pathname, baseline, candidate, path.join(repositoryLink, "report")],
    { encoding: "utf8" },
  );
  assert.notEqual(symlinkEscape.status, 0);
  assert.match(symlinkEscape.stderr, /outside the repository/);

  const guardedOutput = path.join(process.cwd(), ".declaration-contract-destructive-probe");
  const reproduction = path.resolve(path.dirname(script.pathname), "../../docs/evidence/reproduce-typescript-7-comparison.sh");
  const reproductionSource = fs.readFileSync(reproduction, "utf8");
  assert.match(reproductionSource, /node_modules\/typescript\/bin\/tsc/);
  assert.doesNotMatch(reproductionSource, /node_modules\/\.bin\/tsc/);
  assert.match(reproductionSource, /Expected TypeScript baseline Version 6\.0\.3/);
  assert.match(reproductionSource, /Expected TypeScript candidate Version 7\.0\.2/);
  assert.match(reproductionSource, /Checked-in declaration approvals were not fully consumed/);
  const destructiveGuard = spawnSync("bash", [reproduction, guardedOutput], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: process.cwd() },
  });
  assert.equal(destructiveGuard.status, 2);
  assert.match(destructiveGuard.stderr, /must not be inside the repository/);
  assert.equal(fs.existsSync(guardedOutput), false);
  console.log("Declaration contract comparison tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}