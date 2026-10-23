---
name: Local validation runtime index
description: Pointers for the release runner, pinned Node, local browser transport and test certificates.
---

In Replit, `playwright install --with-deps` fails when it tries to use apt; install
browser binaries without `--with-deps` and provision any missing host libraries through
Nix. Keep `--with-deps` for Ubuntu-hosted GitHub Actions runners.

**Why:** Replit routes system dependencies through Nix, while GitHub's Ubuntu runner supports
Playwright's apt-based dependency setup. Chromium's login-shell auto-discovery also stalled
during a local Docker/Caddy preflight, while an explicit executable path worked.

**How to apply:** Use the browser-only installer for a local Replit smoke check and the
`--with-deps` installer in hosted Linux CI. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
explicitly for Docker/Caddy: use the local `chromium` path in Replit and Playwright's
`chromium.executablePath()` after browser installation in hosted CI.

- [Runner locks](release-runner-lock-history.md) — local lock history is private, not platform task history.
- [Package-manager bootstrap](native-pnpm-runtime.md) — distinguish runtime bootstrap from application failures; preserve exact engine and lockfile constraints.
- [Pinned Node](pinned-node-nix-runner.md) — use the exact installed Node when provisioning fails.
- [Pinned pnpm bootstrap](pnpm-workspace-tool-cache.md) — workspace-local tool provisioning can recurse before a validation command starts.
- [Docker healthcheck exec](docker-healthcheck-setns.md) — if healthchecks and `docker exec` both fail with `setns`, preserve CI health semantics and validate on a supported runner.
- [Loopback probes](release-runner-loopback-probes.md) — bypass only local readiness probes, not TLS guards.
- [Browser routing](local-browser-suite-routing.md) — offline installs and scoped loopback exceptions.
- [Test CA subjects](openssl-test-ca-subject-uniqueness.md) — certificate subjects must be unique per fixture.

## Workspace-wide typecheck failures

When the full `pnpm run typecheck` fails outside the changed package, isolate the named package before attributing the failure to the current task. A TypeScript 6.0.3 check of `artifacts/mockup-sandbox` has reproduced the compiler assertion `parameter should have errors when reporting errors` even when run alone, while the calculator package typecheck passes. Do not silently skip the root check or treat the isolated calculator result as a full pass.

Generated API checks can fail earlier if Orval output drifts from the OpenAPI source. Compare temporary generated output with the tracked files; regenerate only when the source contract supports the difference, then rerun the full check to reveal later failures.

**Why:** A clean focused check does not close a configured workspace-wide gate, and generated-contract drift can mask a separate compiler failure.

**How to apply:** Preserve the exact failing command and log, isolate the affected package, repair only source-supported generated drift, and leave the root validation unresolved until the full command passes.

If `run-release-node.sh` exits before a check starts with Node's conflicting `--use-openssl-ca` / `--use-system-ca` options error, inspect inherited `NODE_OPTIONS`. A clean invocation with that inherited option removed allowed the configured isolated browser suite to run in this workspace.

**Why:** The release runner adds its own Node preload while inheriting shell options; a CA-option conflict can prevent validation from reaching the project scripts.

**How to apply:** Preserve the original failure, remove only the conflicting inherited Node option for the retry (for example, `env -u NODE_OPTIONS`), and keep the release runner's own checks and HTTPS protections enabled.

If the system pnpm launcher attempts to bootstrap the workspace's pinned pnpm
version over the package firewall, use the already-installed pinned Node and
pnpm-native executable through a temporary PATH shim for that validation only.
Do not disable the package-manager version check or change the global pnpm.

**Why:** A bootstrap attempt can fail before any project validation starts and
leave managed workflows unable to launch, even when the exact Node and pnpm
tools are already cached locally.

**How to apply:** Check the workspace Node selector and cached native pnpm
version, put those exact executables first on PATH, and keep the normal release
runner, workspace lock, and validation commands intact.
## pnpm bootstrap recursion

Some Replit images expose an older global pnpm than the repository pin. Its
automatic version manager can recursively spawn installers for the pinned pnpm
until the process limit is exhausted. The Linux release runner now resolves
`packageManager` via npm for top-level pnpm commands and keeps the resulting
binary available to nested scripts.

**Why:** Selecting pnpm only for the top-level command leaves child scripts free
to invoke the older binary from `PATH`; the resulting bootstrap recursion can
prevent even Git or unrelated checks from starting.

**How to apply:** Compare the global binary with the repository's manager pin.
For Linux local validation, invoke commands through
`bash scripts/src/run-release-node.sh pnpm ...`; it provisions the exact pin in
a temporary cache, preserves the Node and HTTPS protections, and removes the
cache afterward. If resource exhaustion already occurred, stop only processes
positively identified as the recursive pinned-pnpm bootstrap, not arbitrary
Node services or user installs. The macOS runner remains a separate path that
requires its pinned pnpm to be installed already.

Interactive and automated shells can resolve different package-manager paths.
Check the selected pin in both environments, including nested commands; a
successful manually prefixed command does not establish automated-shell parity.

**Why:** A different manager selection can prevent an automated check from
reaching TypeScript even when an equivalent manual check succeeds.
## Package-manager bootstrap and process exhaustion

Thread-creation or shell-fork failures can come from a recursive package-manager bootstrap, not an application leak. Inspect the command ancestry before treating them as app failures.

**Why:** A workspace-provided older pnpm repeatedly tried to install the project's pinned newer pnpm through itself, exhausting the local process quota before the app or tests started.

**How to apply:** Stop only the identified failed workflow or its confirmed bootstrap subtree; do not broadly kill Node processes. Keep validation locks intact. If exact installed tool commands are used for a bounded check, record that provenance separately from a successful configured workflow.
## Validation runner identity

Verify that the repository's pinned package manager actually starts before interpreting a command failure as a code failure.

**Why:** A workspace bootstrap loop once prevented checks from reaching project scripts; changing repository package policy to repair the environment would have introduced unrelated changes.

**How to apply:** Keep approved toolchain and package policy unchanged during environment repairs. Record whether a failed check reached project code, and verify the pinned runner identity before retrying.
