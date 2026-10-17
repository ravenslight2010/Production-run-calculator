import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = "bash scripts/src/run-release-node.sh ";
const pinnedNodeVersion = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();

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

test("post-merge selects Node before Corepack and package scripts", () => {
  const hook = fs.readFileSync(path.join(root, "scripts/post-merge.sh"), "utf8");
  const reentry = hook.indexOf("exec bash scripts/src/run-release-node.sh");
  const preflight = hook.indexOf("node scripts/src/check-routine-node-version.mjs");
  const stop = hook.indexOf("node scripts/src/stop-artifact-workflows.mjs");
  const corepack = hook.indexOf("corepack enable");
  const install = hook.indexOf("CI=true pnpm install");
  assert.ok(reentry > 0 && preflight > reentry && stop > preflight);
  assert.ok(corepack > stop && install > corepack);
});

function makeShellFixture(
  t,
  { withRuntime = true, requiredVersion = pinnedNodeVersion } = {},
) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "replit-shell-node-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.join(fixture, ".config"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "module-bin"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "scripts", "src"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "store"), { recursive: true });
  fs.writeFileSync(path.join(fixture, ".nvmrc"), `${requiredVersion}\n`);
  fs.copyFileSync(path.join(root, ".config", "bashrc"), path.join(fixture, ".config", "bashrc"));
  fs.copyFileSync(
    path.join(root, "scripts", "src", "select-replit-shell-node.sh"),
    path.join(fixture, "scripts", "src", "select-replit-shell-node.sh"),
  );
  fs.writeFileSync(
    path.join(fixture, "module-bin", "node"),
    "#!/usr/bin/env bash\nprintf '%s\\n' 'v24.13.0'\n",
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
  assert.match(result.stdout, new RegExp(`shell-node=v${escapeRegExp(pinnedNodeVersion)}`));
  assert.match(result.stdout, new RegExp(`shell-exec=${runtimeBinPattern}/node`));
  assert.match(result.stdout, new RegExp(`path-first=${runtimeBinPattern}`));
  assert.match(result.stdout, /node-tls=unset/);
  assert.match(
    result.stdout,
    new RegExp(`v${escapeRegExp(pinnedNodeVersion)}\\|${runtimeBinPattern}/node`),
  );
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