import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicSourceApiTestExcludes,
  vitestPublicSourceExcludeArgs,
  warnPublicSourceApiTestExcludes,
} from "../../../scripts/src/public-source-api-test-excludes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const publicSourceExcludes = publicSourceApiTestExcludes({ root });
const args = [
  "exec",
  "vitest",
  "run",
  "--exclude",
  "src/routes/sync.convergence.integration.test.ts",
  ...vitestPublicSourceExcludeArgs({ root }),
];
warnPublicSourceApiTestExcludes(publicSourceExcludes);
const child = spawn("pnpm", args, { stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 1));
