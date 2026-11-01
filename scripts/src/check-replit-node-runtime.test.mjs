import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerProjectPnpmShimTests } from "./test-helpers/project-pnpm-shims.mjs";
import {
  groupManagedProcesses,
  parseManagedProcessLine,
} from "./stop-artifact-workflows.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = "bash scripts/src/run-release-node.sh ";
const pinnedNodeVersion = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const pinnedPnpmVersion = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).packageManager.slice("pnpm@".length);

registerProjectPnpmShimTests(root, pinnedPnpmVersion);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("every Replit validation command selects Node before launching children", () => {
  const config = fs.readFileSync(path.join(root, ".replit"), "utf8");
  const sections = config.split("[[workflows.workflow]]").slice(1);
  let checked = 0;
  for (const section of sections) {
    const name = section.match(/^name = "([^"]+)"/m)?.[1];
    if (name === "Project") continue;
    const command = section.match(/^args = "([^"]+)"$/m)?.[1];
    assert.ok(command, `${name}: missing shell command`);
    if (name === "Local AI evaluator (private)") {
      assert.equal(command, "python3 scripts/local_model_eval_setup.py serve");
      continue;
    }
    assert.ok(command.startsWith(launcher), `${name}: must select pinned Node first`);
    checked++;
  }
  assert.ok(checked >= 18, "expected all Replit validation entry points");
});

test("deployment, post-merge, and artifact entry points use the pinned selector", () => {
  const replit = fs.readFileSync(path.join(root, ".replit"), "utf8");
  const deployment = replit.split("[deployment]")[1]?.split("[workflows]")[0];
  assert.ok(deployment);
  assert.match(deployment, /build = "bash scripts\/src\/run-project-pnpm\.sh /);
  assert.match(deployment, /run = \["sh", "-c", "bash scripts\/src\/run-project-pnpm\.sh /);
  assert.match(deployment, /args = \["bash", "scripts\/src\/run-project-pnpm\.sh", "store", "prune"\]/);

  const postMerge = fs.readFileSync(path.join(root, "scripts", "post-merge.sh"), "utf8");
  assert.match(postMerge, /bash scripts\/src\/run-project-pnpm\.sh/);
  assert.doesNotMatch(postMerge, /(?:^|\s)pnpm (?:install|--filter|run)\b/m);

  for (const artifactPath of [
    "artifacts/api-server/.replit-artifact/artifact.toml",
    "artifacts/run-calculator/.replit-artifact/artifact.toml",
    "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
  ]) {
    const config = fs.readFileSync(path.join(root, artifactPath), "utf8");
    assert.match(config, /run = "bash \.\.\/\.\.\/scripts\/src\/run-project-pnpm\.sh/);
    assert.doesNotMatch(config, /(?:^|[=\s\[])"?pnpm(?:\s|",)/m);
  }
});

test("post-merge selects Node before Corepack and package scripts", () => {
  const hook = fs.readFileSync(path.join(root, "scripts/post-merge.sh"), "utf8");
  const reentry = hook.indexOf("exec bash scripts/src/run-release-node.sh");
  const preflight = hook.indexOf("node scripts/src/check-routine-node-version.mjs");
  const stop = hook.indexOf("node scripts/src/stop-artifact-workflows.mjs");
  const corepack = hook.indexOf("corepack enable");
  const selection = hook.indexOf("pnpm-selection");
  const install = hook.indexOf("CI=true bash scripts/src/run-project-pnpm.sh install");
  assert.ok(reentry > 0 && preflight > reentry && stop > preflight);
  assert.equal(corepack, -1, "post-merge must use the shared pinned-pnpm selector");
  assert.ok(selection > stop && install > selection);
});

function makePostMergeFixture(t) {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "post-merge-phases-"));
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  const fixture = path.join(fixtureParent, "workspace");
  const home = path.join(fixtureParent, "home");
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "bin"), { recursive: true });
  fs.mkdirSync(path.join(fixture, ".config"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
  JSON.stringify({ packageManager: `pnpm@${pinnedPnpmVersion}` }),
  );
  fs.writeFileSync(path.join(fixture, "pnpm-workspace.yaml"), "packages: []\n");
  fs.copyFileSync(
    path.join(root, "scripts", "post-merge.sh"),
    path.join(fixture, "scripts", "post-merge.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "configure-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "configure-project-pnpm.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "run-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "run-project-pnpm.sh"),
  );

  const executables = {
    "scripts/src/run-release-node.sh": `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == env && "$2" == REPLIT_PINNED_NODE_READY=1 &&
  "$3" == bash && "$4" == scripts/post-merge.sh ]]
cd "$FIXTURE_ROOT"
exec env REPLIT_PINNED_NODE_READY=1 bash scripts/post-merge.sh
`,
    "bin/node": `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == -e ]]; then
  exec "$REAL_NODE_BIN" "$@"
fi
case "$1" in
  scripts/src/check-routine-node-version.mjs) exit "\${TEST_NODE_CHECK_STATUS:-0}" ;;
  scripts/src/stop-artifact-workflows.mjs) exit "\${TEST_STOP_STATUS:-0}" ;;
  *) printf 'unexpected fake node operation\\n' >&2; exit 90 ;;
esac
`,
    "bin/corepack": `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == enable && "$2" == --install-directory && "$4" == pnpm ]]; then
  exit "\${TEST_COREPACK_STATUS:-0}"
fi
if [[ "$1" == pnpm ]]; then
  shift
  if [[ "\${1:-}" == --version ]]; then
    printf '%s\\n' '${pinnedPnpmVersion}'
    exit 0
  fi
  exec "$FAKE_SYSTEM_PNPM" "$@"
fi
printf 'unexpected fake Corepack operation\\n' >&2
exit 92
`,
    "bin/pnpm": `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == install ]]; then
  exit "\${TEST_INSTALL_STATUS:-0}"
fi
if [[ "$1" == --filter && "$2" == db && "$3" == push-force ]]; then
  count=0
  [[ -f "$FIXTURE_ROOT/push-attempt-count" ]] &&
    read -r count <"$FIXTURE_ROOT/push-attempt-count"
  count=$((count + 1))
  printf '%s\\n' "$count" >"$FIXTURE_ROOT/push-attempt-count"
  if (( count <= \${TEST_PUSH_FAILURES:-0} )); then
    exit 37
  fi
  exit 0
fi
if [[ "$1" == run && "$2" == prepare:publish ]]; then
  exit "\${TEST_PREPARE_STATUS:-0}"
fi
printf 'unexpected fake pnpm operation\\n' >&2
exit 91
`,
    "bin/sleep": `#!/usr/bin/env bash
exit 0
`,
  };
  for (const [relativePath, contents] of Object.entries(executables)) {
    const absolutePath = path.join(fixture, relativePath);
    fs.writeFileSync(absolutePath, contents, { mode: 0o755 });
  }
  const corepackPath = path.join(fixture, "bin", "corepack");
  fs.writeFileSync(
    corepackPath,
    fs.readFileSync(corepackPath, "utf8").replace(
      'if [[ "$1" == enable && "$2" == --install-directory && "$4" == pnpm ]]; then\n  exit "\${TEST_COREPACK_STATUS:-0}"\nfi',
      `if [[ "$1" == enable && "$2" == --install-directory && "$4" == pnpm ]]; then
  cat >"$3/pnpm" <<'SHIM'
#!/usr/bin/env bash
exec "$FAKE_COREPACK_BIN" pnpm "$@"
SHIM
  chmod +x "$3/pnpm"
  exit "\${TEST_COREPACK_STATUS:-0}"
fi`,
    ),
    { mode: 0o755 },
  );
  return fixture;
}

function runPostMergeFixture(fixture, overrides = {}) {
  return spawnSync("bash", ["scripts/post-merge.sh"], {
    cwd: fixture,
    encoding: "utf8",
    env: {
      ...process.env,
      ...overrides,
      FIXTURE_ROOT: fixture,
      REAL_NODE_BIN: process.execPath,
      HOME: path.join(fixture, "..", "home"),
      FAKE_COREPACK_BIN: path.join(fixture, "bin", "corepack"),
      FAKE_SYSTEM_PNPM: path.join(fixture, "bin", "pnpm"),
      PATH: `${path.join(fixture, "bin")}:${process.env.PATH}`,
    },
  });
}

test("post-merge phase events stay bounded and preserve retries and failures", (t) => {
  const fixture = makePostMergeFixture(t);
  const success = runPostMergeFixture(fixture, {
    TEST_PUSH_FAILURES: "1",
    TEST_PRIVATE_VALUE: "DO_NOT_LOG_THIS_VALUE",
  });
  assert.equal(success.status, 0, success.stderr);
  for (const phase of [
    "node-version-check",
    "stop-artifact-workflows",
    "pnpm-selection",
    "frozen-install",
    "schema-push-attempt-1",
    "schema-push-attempt-2",
    "prepare-publish",
  ]) {
    assert.match(
      success.stderr,
      new RegExp(`post-merge phase=start name=${phase} timestamp_utc=\\d{4}-\\d\\d-\\d\\dT`),
    );
    assert.match(
      success.stderr,
      new RegExp(`post-merge phase=end name=${phase} outcome=(success|failure) elapsed_seconds=\\d+ exit_code=\\d+ timestamp_utc=\\d{4}-`),
    );
  }
  assert.match(
    success.stderr,
    /post-merge phase=end name=schema-push-attempt-1 outcome=failure elapsed_seconds=\d+ exit_code=37/,
  );
  assert.match(
    success.stderr,
    /post-merge phase=end name=schema-push-attempt-2 outcome=success elapsed_seconds=\d+ exit_code=0/,
  );
  assert.equal(
    fs.readFileSync(path.join(fixture, "push-attempt-count"), "utf8").trim(),
    "2",
  );
  assert.doesNotMatch(success.stderr, /DO_NOT_LOG_THIS_VALUE/);

  const failedFixture = makePostMergeFixture(t);
  const failure = runPostMergeFixture(failedFixture, { TEST_INSTALL_STATUS: "23" });
  assert.equal(failure.status, 23, failure.stderr);
  assert.match(
    failure.stderr,
    /post-merge phase=end name=frozen-install outcome=failure elapsed_seconds=\d+ exit_code=23/,
  );
  assert.doesNotMatch(failure.stderr, /name=schema-push-attempt-|name=prepare-publish/);

  const exhaustedFixture = makePostMergeFixture(t);
  const exhausted = runPostMergeFixture(exhaustedFixture, {
    TEST_PUSH_FAILURES: "4",
  });
  assert.equal(exhausted.status, 37, exhausted.stderr);
  assert.match(
    exhausted.stderr,
    /post-merge phase=end name=schema-push-attempt-4 outcome=failure elapsed_seconds=\d+ exit_code=37/,
  );
  assert.match(exhausted.stderr, /db push-force failed after 4 attempts/);
  assert.doesNotMatch(exhausted.stderr, /name=prepare-publish/);
  assert.equal(
    fs.readFileSync(path.join(exhaustedFixture, "push-attempt-count"), "utf8").trim(),
    "4",
  );
});

test("artifact workflow cleanup retains only process identity and artifact class", () => {
  const parsed = parseManagedProcessLine(
    "420 400 pnpm --filter @workspace/api-server run dev --debug-token PRIVATE_SENTINEL",
  );
  assert.deepEqual(parsed, { pid: 420, pgid: 400, artifact: "api-server" });
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_SENTINEL/);

  const groups = groupManagedProcesses([
    "420 400 pnpm --filter @workspace/api-server run dev PRIVATE_SENTINEL",
    "421 400 node /path/to/api-server/dist/index.mjs PRIVATE_SENTINEL",
    "510 510 pnpm --filter @workspace/run-calculator run dev",
    "700 700 unrelated-service --filter @workspace/api-server run dev",
  ]);
  assert.deepEqual(
    [...groups.entries()],
    [
      [400, { pid: 420, pgid: 400, artifact: "api-server" }],
      [510, { pid: 510, pgid: 510, artifact: "run-calculator" }],
    ],
  );
  assert.doesNotMatch(JSON.stringify([...groups]), /PRIVATE_SENTINEL/);
});

function makeShellFixture(
  t,
  { withRuntime = true, requiredVersion = pinnedNodeVersion } = {},
) {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "replit-shell-node-"));
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  const fixture = path.join(fixtureParent, "workspace");
  fs.mkdirSync(path.join(fixture, ".config"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "module-bin"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "store"), { recursive: true });
  fs.mkdirSync(path.join(fixtureParent, "home"), { recursive: true });
  fs.writeFileSync(path.join(fixture, ".nvmrc"), `${requiredVersion}\n`);
  fs.writeFileSync(
    path.join(fixture, "package.json"),
  JSON.stringify({ packageManager: `pnpm@${pinnedPnpmVersion}` }),
  );
  fs.copyFileSync(path.join(root, ".config", "bashrc"), path.join(fixture, ".config", "bashrc"));
  fs.copyFileSync(
    path.join(root, "scripts", "src", "select-replit-shell-node.sh"),
    path.join(fixture, "scripts", "src", "select-replit-shell-node.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "configure-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "configure-project-pnpm.sh"),
  );
  fs.writeFileSync(
    path.join(fixture, "module-bin", "node"),
    `#!/usr/bin/env bash
if [[ "\${1:-}" == -e ]]; then
  exec "${process.execPath}" "$@"
fi
printf '%s\\n' 'v24.13.0'
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(fixture, "module-bin", "corepack"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == enable && "$2" == --install-directory && "$4" == pnpm ]]; then
  cat >"$3/pnpm" <<'SHIM'
#!/usr/bin/env bash
exec "$FAKE_COREPACK_BIN" pnpm "$@"
SHIM
  chmod +x "$3/pnpm"
  exit 0
fi
if [[ "$1" == pnpm ]]; then
  shift
  if [[ "\${1:-}" == --version ]]; then
    printf '%s\\n' '${pinnedPnpmVersion}'
    exit 0
  fi
  if [[ "$1" == --dir && "$3" == run && "$4" == check-shell-node ]]; then
    exec node -p 'process.version + "|" + process.execPath'
  fi
fi
printf 'unexpected shell fixture Corepack call: %s\\n' "$*" >&2
exit 93
`,
    { mode: 0o755 },
  );

  if (withRuntime) {
    const runtimeBin = path.join(
      fixture,
      "store",
      `fixture-nodejs-${requiredVersion}`,
      "bin",
    );
    fs.mkdirSync(runtimeBin, { recursive: true });
    const fakeNode = path.join(runtimeBin, "node");
    fs.writeFileSync(
      fakeNode,
      `#!/usr/bin/env bash
if [[ "\${1:-}" == -e ]]; then
  exec "${process.execPath}" "$@"
fi
case "\${1:-}" in
  --version) printf '%s\\n' 'v${requiredVersion}' ;;
  -p)
    case "\${2:-}" in
      process.execPath) printf '%s\\n' "$0" ;;
      process.version) printf '%s\\n' 'v${requiredVersion}' ;;
      process.version*) printf 'v${requiredVersion}|%s\\n' "$0" ;;
      *) printf 'unexpected expression: %s\\n' "\${2:-}" >&2; exit 2 ;;
    esac
    ;;
  *) printf 'unexpected fake Node arguments: %s\\n' "$*" >&2; exit 2 ;;
esac
`,
      { mode: 0o755 },
    );
  }

  return fixture;
}

function runReplitShell(fixture, command) {
  return spawnSync(
    "bash",
    ["-c", `source "$REPL_HOME/.config/bashrc"\n${command}`],
    {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        REPL_HOME: fixture,
        HOME: path.join(path.dirname(fixture), "home"),
        REAL_NODE_BIN: process.execPath,
        FAKE_COREPACK_BIN: path.join(fixture, "module-bin", "corepack"),
        XDG_DATA_HOME: path.join(fixture, ".local", "share"),
        PATH: `${path.join(fixture, "module-bin")}:${process.env.PATH}`,
        REPLIT_SHELL_NODE_STORE_ROOT: path.join(fixture, "store"),
        NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      },
    },
  );
}

test("Replit interactive Bash startup selects the exact pinned Node for shell and package children", (t) => {
  const fixture = makeShellFixture(t);
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({
      private: true,
      packageManager: "pnpm@12.8.1",
      scripts: {
        "check-shell-node": "node -p 'process.version + \"|\" + process.execPath'",
      },
    }),
  );

  const result = runReplitShell(
    fixture,
    [
      'printf "shell-node=%s\\n" "$(node --version)"',
      'printf "shell-exec=%s\\n" "$(node -p process.execPath)"',
      'printf "path-first=%s\\n" "${PATH%%:*}"',
      'printf "node-tls=%s\\n" "${NODE_TLS_REJECT_UNAUTHORIZED:-unset}"',
      'pnpm --dir "$REPL_HOME" run check-shell-node',
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  const runtimeBin = path.join(
    fixture,
    "store",
    `fixture-nodejs-${pinnedNodeVersion}`,
    "bin",
  );
  const runtimeBinPattern = escapeRegExp(runtimeBin);
  const pnpmShimDir = path.join(
    fixture,
    ".config",
    "npm",
    "node_global",
    "bin",
  );
  assert.match(result.stdout, new RegExp(`shell-node=v${escapeRegExp(pinnedNodeVersion)}`));
  assert.match(result.stdout, new RegExp(`shell-exec=${runtimeBinPattern}/node`));
  assert.match(result.stdout, new RegExp(`path-first=${escapeRegExp(pnpmShimDir)}`));
  assert.match(result.stdout, /node-tls=unset/);
  assert.match(
    result.stdout,
    new RegExp(`v${escapeRegExp(pinnedNodeVersion)}\\|${runtimeBinPattern}/node`),
  );
});

test("direct and nested pnpm calls select the root pin with workspace-local XDG data", (t) => {
  const fixtureParent = fs.mkdtempSync(
    path.join(os.tmpdir(), "project-pnpm-selection-"),
  );
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  const fixture = path.join(fixtureParent, "workspace");
  const home = path.join(fixtureParent, "home");
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "bin"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(fixture, ".local", "share"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ packageManager: "pnpm@12.8.1" }),
  );
  fs.writeFileSync(path.join(fixture, "pnpm-workspace.yaml"), "packages: []\n");
  fs.copyFileSync(
    path.join(root, "scripts", "src", "configure-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "configure-project-pnpm.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "run-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "run-project-pnpm.sh"),
  );
  fs.writeFileSync(
    path.join(fixture, "bin", "corepack"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == enable && "$2" == --install-directory && "$4" == pnpm ]]; then
  printf 'enable xdg=%s cache=%s\\n' "$XDG_DATA_HOME" "$COREPACK_HOME" >>"$TRACE_FILE"
  cat >"$3/pnpm" <<'SHIM'
#!/usr/bin/env bash
exec "$FAKE_COREPACK_BIN" pnpm "$@"
SHIM
  chmod +x "$3/pnpm"
  exit 0
fi
if [[ "$1" == pnpm ]]; then
  shift
  printf 'pinned args=%s\\n' "$*" >>"$TRACE_FILE"
  if [[ "\${1:-}" == --version ]]; then
    printf '%s\\n' '12.8.1'
    exit 0
  fi
  if [[ "$1" == run && "$2" == nested ]]; then
    exec "$NESTED_COMMAND"
  fi
fi
printf 'unexpected fake Corepack operation: %s\\n' "$*" >&2
exit 94
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(fixture, "bin", "pnpm"),
    `#!/usr/bin/env bash
printf 'old-system-pnpm %s\\n' "$*" >>"$TRACE_FILE"
printf '%s\\n' '10.26.1'
`,
    { mode: 0o755 },
  );
  const trace = path.join(fixture, "trace.log");
  const nested = path.join(fixture, "nested-command.sh");
  fs.writeFileSync(
    nested,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'nested-version=%s\\n' "$(pnpm --version)"
`,
    { mode: 0o755 },
  );
  const environment = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: path.join(fixture, ".local", "share"),
    TRACE_FILE: trace,
    FAKE_COREPACK_BIN: path.join(fixture, "bin", "corepack"),
    NESTED_COMMAND: nested,
    PATH: `${path.join(fixture, "bin")}:${process.env.PATH}`,
  };
  const result = spawnSync(
    "bash",
    ["scripts/src/run-project-pnpm.sh", "run", "nested"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 5000,
      env: environment,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`nested-version=${escapeRegExp(pinnedPnpmVersion)}`));
  assert.doesNotMatch(result.stdout + result.stderr, /recursive|self-install/i);
  const calls = fs.readFileSync(trace, "utf8");
  assert.match(calls, /enable xdg=.*project-pnpm-selection-.*\/\.local\/share/);
  assert.match(calls, /cache=.*project-pnpm-selection-.*\/home\/\.cache\/node\/corepack/);
  assert.equal((calls.match(/pinned args=--version/g) ?? []).length, 2);
  assert.match(calls, /pinned args=run nested/);
  assert.doesNotMatch(calls, /old-system-pnpm/);
  assert.ok(fs.existsSync(path.join(fixture, "pnpm-workspace.yaml")));
  for (const artifact of ["api-server", "run-calculator", "mockup-sandbox"]) {
    const artifactDir = path.join(fixture, "artifacts", artifact);
    fs.mkdirSync(artifactDir, { recursive: true });
    const config = fs.readFileSync(
      path.join(root, "artifacts", artifact, ".replit-artifact", "artifact.toml"),
      "utf8",
    );
    const script = config.match(/^run = "bash (\S+run-project-pnpm\.sh) /m)?.[1];
    assert.ok(script, `${artifact}: missing development selector`);
    const workflowResult = spawnSync("bash", [script, "--version"], {
      cwd: artifactDir,
      env: environment,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(workflowResult.status, 0, `${artifact}: ${workflowResult.stderr}`);
    assert.equal(workflowResult.stdout.trim(), pinnedPnpmVersion);
  }
});

test("real Corepack cold start ignores an older system pnpm with workspace-local XDG", (t) => {
  const fixtureParent = fs.mkdtempSync(
    path.join(os.tmpdir(), "project-pnpm-real-cold-start-"),
  );
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  const fixture = path.join(fixtureParent, "workspace");
  const home = path.join(fixtureParent, "home");
  const cache = path.join(fixtureParent, "corepack-cache");
  const bin = path.join(fixtureParent, "old-manager-bin");
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, ".local", "share"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({
      packageManager: `pnpm@${pinnedPnpmVersion}`,
      scripts: { "startup:probe": "pnpm --version" },
    }),
  );
  fs.writeFileSync(path.join(fixture, "pnpm-workspace.yaml"), "packages: []\n");
  fs.copyFileSync(
    path.join(root, "scripts", "src", "configure-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "configure-project-pnpm.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "run-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "run-project-pnpm.sh"),
  );
  const legacyPnpmCalls = path.join(fixtureParent, "legacy-pnpm-calls.log");
  fs.writeFileSync(
    path.join(bin, "pnpm"),
    `#!/usr/bin/env bash
printf 'legacy pnpm was invoked: %s\\n' "$*" >>"${legacyPnpmCalls}"
printf '%s\\n' '10.26.1'
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "python3",
    [
      path.join(root, "scripts", "src", "fixtures", "pnpm-startup-process-guard.py"),
      "bash",
      path.join(fixture, "scripts", "src", "run-project-pnpm.sh"),
      "run",
      "startup:probe",
    ],
    {
      cwd: fixtureParent,
      encoding: "utf8",
      timeout: 75_000,
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: path.join(fixture, ".local", "share"),
        COREPACK_HOME: cache,
        COREPACK_NPM_REGISTRY: "https://registry.npmjs.org/",
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        PATH: `${bin}:${process.env.PATH}`,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`(?:^|\\n)${escapeRegExp(pinnedPnpmVersion)}(?:\\r?\\n|$)`),
  );
  assert.doesNotMatch(result.stdout + result.stderr, /Do you want to continue/);
  assert.match(result.stdout, /PNPM_FIXTURE_MAX_PROCESSES=[1-9][0-9]*/);
  assert.doesNotMatch(result.stdout + result.stderr, /legacy pnpm was invoked/);
  assert.equal(fs.existsSync(legacyPnpmCalls), false);
  assert.ok(fs.existsSync(path.join(fixture, "pnpm-workspace.yaml")));
  assert.ok(fs.existsSync(cache), "cold Corepack cache should be isolated from workspace XDG");
  assert.equal(path.resolve(cache).startsWith(`${path.resolve(fixture)}${path.sep}`), false);
});

test("unsafe workspace-local Corepack caches fail before manager startup", (t) => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "project-pnpm-unsafe-cache-"));
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  const fixture = path.join(fixtureParent, "workspace");
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ packageManager: "pnpm@12.8.1" }),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "configure-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "configure-project-pnpm.sh"),
  );
  fs.copyFileSync(
    path.join(root, "scripts", "src", "run-project-pnpm.sh"),
    path.join(fixture, "scripts", "src", "run-project-pnpm.sh"),
  );
  fs.writeFileSync(
    path.join(fixture, "bin", "corepack"),
    "#!/usr/bin/env bash\nprintf 'unexpected corepack call\\n' >&2\nexit 95\n",
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    ["scripts/src/run-project-pnpm.sh", "--version"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 3000,
      env: {
        ...process.env,
        HOME: fixture,
        COREPACK_HOME: path.join(fixture, ".local", "share", "pnpm"),
        PATH: `${path.join(fixture, "bin")}:${process.env.PATH}`,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COREPACK_HOME must be outside the workspace/);
  assert.doesNotMatch(result.stderr, /unexpected corepack call/);

  const redirectedCache = path.join(fixtureParent, "cache-link");
  fs.mkdirSync(path.join(fixture, ".local", "share"), { recursive: true });
  fs.symlinkSync(path.join(fixture, ".local", "share"), redirectedCache);
  const symlinkResult = spawnSync(
    "bash",
    ["scripts/src/run-project-pnpm.sh", "--version"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 3000,
      env: {
        ...process.env,
        HOME: path.dirname(fixture),
        COREPACK_HOME: redirectedCache,
        PATH: `${path.join(fixture, "bin")}:${process.env.PATH}`,
      },
    },
  );
  assert.notEqual(symlinkResult.status, 0);
  assert.match(symlinkResult.stderr, /COREPACK_HOME must be outside the workspace/);
  assert.doesNotMatch(symlinkResult.stderr, /unexpected corepack call/);

  const httpRegistryResult = spawnSync(
    "bash",
    ["scripts/src/run-project-pnpm.sh", "--version"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 3000,
      env: {
        ...process.env,
        HOME: path.dirname(fixture),
        COREPACK_HOME: path.join(path.dirname(fixture), "safe-cache"),
        COREPACK_NPM_REGISTRY: "http://registry.invalid/",
        PATH: `${path.join(fixture, "bin")}:${process.env.PATH}`,
      },
    },
  );
  assert.notEqual(httpRegistryResult.status, 0);
  assert.match(httpRegistryResult.stderr, /COREPACK_NPM_REGISTRY must be an HTTPS registry URL/);
  assert.doesNotMatch(httpRegistryResult.stderr, /unexpected corepack call/);
});

test("interactive shell exits with guidance instead of silently retaining the wrong Node", (t) => {
  const fixture = makeShellFixture(t, { withRuntime: false });
  const result = runReplitShell(fixture, 'printf "SHELL_STARTED_WITH_FALLBACK\\n"');
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`Cannot start this interactive shell with the required Node v${escapeRegExp(pinnedNodeVersion)}`),
  );
  assert.match(
    result.stderr,
    new RegExp(`Restore Node v${escapeRegExp(pinnedNodeVersion)} to the Replit environment`),
  );
  assert.doesNotMatch(result.stdout, /SHELL_STARTED_WITH_FALLBACK/);
});

test("interactive shell follows a changed .nvmrc value instead of a hardcoded patch", (t) => {
  const fixture = makeShellFixture(t, { requiredVersion: "24.18.3" });
  const result = runReplitShell(fixture, 'node --version');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v24\.18\.3/);
});