// Explicit source-build command, not an updater or a normal offline restart.
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "../src/build-source-identity.mjs";
import { inspectPreflight } from "./preflight.mjs";
try {
  if (
    process.argv.length !== 2 ||
    inspectPreflight(PROJECT_ROOT, { profile: "self-host-fresh" }).status !==
      "ready"
  )
    throw new Error();
  const env = {
    ...process.env,
    BUILD_IDENTITY_MODE: "self-host-fresh",
    PORT: "3000",
    BASE_PATH: "/",
  };
  // pnpm's Windows shim needs a shell; the executable/arguments are fixed here,
  // never interpolated from user input. Unix uses the executable directly.
  for (const [program, args] of [
    [process.execPath, ["scripts/self-host/prepare-source.mjs"]],
    ["pnpm", ["--filter", "@workspace/run-calculator", "run", "build"]],
    ["pnpm", ["--filter", "@workspace/api-server", "run", "build"]],
    [process.execPath, ["scripts/self-host/finalize.mjs"]],
  ]) {
    const result = spawnSync(program, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",
      shell: process.platform === "win32" && program === "pnpm",
    });
    if (result.status !== 0) throw new Error();
  }
} catch {
  console.error(
    "Fresh self-host build did not complete. No release or installation approval was created.",
  );
  process.exitCode = 1;
}
