import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const publicCi =
  process.env.CI_PUBLIC_SOURCE === "1" || process.env.CI_PUBLIC_SOURCE === "true";
const report = path.join(
  root,
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
);
const args = [
  "exec",
  "vitest",
  "run",
  "--exclude",
  "src/routes/sync.convergence.integration.test.ts",
];
if (publicCi && !existsSync(report)) {
  args.push(
    "--exclude",
    "src/lib/sourceLibraryReconciliationCapture.test.ts",
    "--exclude",
    "src/lib/sourceLibraryReconciliationHeal.integration.test.ts",
  );
  console.warn(
    "CI_PUBLIC_SOURCE: excluding source-library reconciliation API tests (assets absent).",
  );
}
const child = spawn("pnpm", args, { stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 1));
