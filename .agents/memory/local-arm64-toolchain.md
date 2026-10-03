---
name: Local ARM64 toolchain
description: The ARM host details that are not already in the lockfile x64 note — shellcheck, the Codex-hosted Node runtime, and why the shared skill text is stale.
---

This extends, and does not repeat, the lockfile x64-binary note already recorded
in `codex-fixes.md` (repeated at the 2026-09-16 merge entries): the arm64
sibling packages must be installed by hand into `node_modules/.pnpm` and are
never committed. Read that note first; this file only adds what it omits.

**Do not replace the system Node.** On this host `/usr/local/bin/node` is not
just a Node install — it is the interpreter running the Codex session, and
`/usr/local/lib/node_modules` holds `@openai/codex`, `codexui-android`,
`openclaw`, `opencode-ai`, and the Android bridge tools (`bsh`, `am`, `intent`,
`host-bridge`). Because the `codex` entry point is `#!/usr/bin/env node`,
prepending another Node to `PATH` silently changes which interpreter runs Codex.

**Why:** The arm64 binary gap looks like a repo defect and points straight at
`pnpm-lock.yaml`, which this box must not regenerate. Separately, the shared
`verify-before-commit` skill tells agents ARM cannot run vitest at all, so they
mirror logic into `node -e` and skip real tests that now run fine here. Both
cost more time than the underlying gap.

**How to apply:**

- **Node selection:** use `.nvmrc` + `scripts/src/run-release-node.sh`, which
  puts the matching executable first on `PATH` and falls back to
  `npx --package=node@<version>`. See [Release Node
  pinning](release-node-pinning.md); do not invent a second mechanism. A
  side-by-side install under `/opt` plus a per-shell `PATH` export is a safe
  alternative for interactive work, since it leaves `/usr/local` untouched.

- **`shellcheck` is a real prerequisite, not an optional lint.** The repo runs
  it in `check:generated`, so `CI=true pnpm run typecheck` aborts early without
  it, before any TypeScript runs. Install with
  `apt-get update -qq && apt-get install -y shellcheck`. The drift rules live in
  [Shell lint inventory](shell-lint-inventory.md).

- **The oxide shim is not a `.node` drop-in.** `lightningcss` accepts a bare
  `lightningcss.linux-arm64-gnu.node` in its package dir, but
  `@tailwindcss/oxide` loader calls `require('@tailwindcss/oxide-linux-arm64-gnu')`
  and needs a real installed package, symlinked into
  `node_modules/.pnpm/@tailwindcss+oxide@4.3.3/node_modules/@tailwindcss/`. That
  asymmetry is the confusing part of the manual install.

- **Any reinstall reverts all of this,** including the arm64 shims. Re-apply them
  before running Vite-dependent commands, or expect
  `Cannot find native binding` again.

- **Verify with `CI=true pnpm run typecheck`**, never `build`. Prefer CI as the
  real test gate: local Postgres is unavailable (the kernel lacks SysV IPC), and
  this host runs under `libproot` with roughly one effective core, so a single
  vitest file takes ~32s and the full web suite is impractical.
