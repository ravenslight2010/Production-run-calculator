import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function put(root, file, content = "fixture\n") {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

export function sourceFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "source-identity-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const dir of ["lib", "scripts/src", "artifacts/api-server/src", "artifacts/run-calculator/src",
    "attached_assets/source-library/audits"])
    mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "artifacts/api-server/src/index.ts", "artifacts/run-calculator/src/main.ts",
    "artifacts/api-server/build.mjs", "artifacts/run-calculator/vite.config.ts",
    "lib/math/src/index.ts", "scripts/src/build.mjs", "artifacts/run-calculator/public/icon.svg",
    "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
    "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.sha256"])
    put(root, file);
  return root;
}

export function outputs(root) {
  put(root, "artifacts/api-server/dist/index.mjs", "export const built = true;\n");
  put(root, "artifacts/run-calculator/dist/public/index.html", "<html>built fixture</html>\n");
}