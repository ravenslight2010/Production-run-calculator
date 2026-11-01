---
name: Workspace-local pnpm tool bootstrap
description: Pinned pnpm bootstrap, startup shim concurrency and cache safety.
---

Use the supported release runner for local validation rather than an older
system manager. A package-manager bootstrap failure is not a project-check result.

**Why:** A temporary installer can inherit the ancestor workspace's manager pin
and recursively provision itself, exhausting resources before the check starts.

**How to apply:** For deterministic local validation, invoke pnpm commands
through `bash scripts/src/run-release-node.sh pnpm ...`. Preserve pinned Node
and HTTPS-only safeguards; do not change `packageManager` or the lockfile to
repair local provisioning. Check retained output for the actual validation
command before diagnosing application code or claiming a check passed.

If the runner stalls before the requested command, compare the shell's Node
with the repository pin before diagnosing pnpm or a validation-lock fault.

**Why:** A shell runtime update caused the runner to fall back to external
Node acquisition even though the retained pinned executable was still present.
Both a pnpm check and a direct-Node check then stalled before collection.

**How to apply:** Verify the retained executable against the repository pin,
put its directory first on PATH, and keep using the supported runner. Do not
bypass its lock or TLS guards or count the bootstrap attempts as test failures.

Ad-hoc external tool links can outlive their temporary targets. Also, a version
check through a shell or Node launcher is not proof that a direct child-process
spawn can execute the same entry.

Concurrent app launches must not replace shared package-manager launchers using
an unprotected remove-then-create sequence.

**Why:** Parallel Corepack enablement can remove a path another launcher already
observed, producing ENOENT before application code starts. Such a failure is not
by itself evidence of a sync/database outage or an Agent-storage incident.

**How to apply:** Prepare and validate entry points privately, publish them
atomically on the same filesystem and preserve relative-link correctness when
relocating them. Failed preparation must retain the prior launcher and must
not fall through to an older host manager. Do not serialize entire running
services to protect this short setup operation.

Negative launcher tests need a denied host fallback and private HOME, XDG and
package-manager cache locations, not just a temporary project directory.

**Why:** A dangling launcher can be skipped during PATH lookup. Even a version
probe can then reach the host manager and attempt to bootstrap another native
binary. Inherited XDG settings can also escape an otherwise disposable HOME.

**How to apply:** Shadow fallback commands with explicit failures, allowlist
child environment variables and disable network access for synthetic launcher
fixtures. Keep genuine offline-runtime evidence separate from these mocks.

**Why:** Workspace links and external caches have different lifetimes. A
plain-text fallback may work through a shell-mediated launcher but fail with
ENOEXEC when an app starter spawns it directly.

**How to apply:** Prefer the canonical runner for checks. When restoring an
existing app workflow that uses a bare manager, verify its link target exists,
its exact pin and a direct child-process version check. Provision with integrity
verification and use the verified native executable or a proper executable
launcher. Never weaken TLS, change the repository pin or count an unstarted
check as passed.

Recursive provisioning can exhaust the container's process/thread limit,
making unrelated app workflows fail.

**Why:** Concurrent launches can amplify a recursive version switch into many
installer processes, causing workflow failures unrelated to application code.

**How to apply:** Inspect process ancestry, stop only the confirmed recursive
installer tree, repair tool provisioning and then restore affected workflows.

Inline probes must not rely on stdin surviving the provisioning wrapper.

**Why:** A heredoc-fed Node probe exited successfully without executing its
script after npm-based provisioning consumed or detached stdin.

**How to apply:** Pass inline scripts through `--eval`, or use a script file,
and require an explicit result marker rather than treating exit zero as proof
that the probe ran.

Managed Replit workflows can present a terminal to Corepack even when an
ordinary child-process test has no terminal.

**Why:** Cold-cache provisioning passed in a piped test but stalled on the
download-confirmation prompt in the actual managed workflow. Disabling that
prompt for the approved exact pin does not disable signature or TLS checks.

**How to apply:** Retain cold-cache PTY coverage with a deadline and a
fixture-owned process-session guard; a non-TTY version probe alone does not
prove unattended workflow startup.

Offline proof must include pnpm's native payload, not only the Corepack
dispatcher archive. Warming and packing must happen outside project discovery.

**Why:** pnpm 12's Corepack package dispatches to a separately downloaded native
executable. A signed Corepack pack and passing metadata tests did not establish
that a cold, network-isolated manager could execute.

**How to apply:** Keep default TLS and npm-signature verification enabled while
preparing the exact pin, retain the platform payload, then require a fresh-cache
OS-network-isolated execution with loopback available and actual application
startup. Warm-cache version checks and archive integrity are necessary evidence,
not startup certification. Do not enable a startup-cache optimization by default
before that handoff passes.

Project-aware offline bootstrap needs the complete source lockfile, including
pnpm 12's leading package-manager bootstrap document.

**Why:** A verified native payload worked outside a project, but a cloned project
that omitted the lockfile attempted DNS and stalled despite Corepack networking
being disabled. Adding the byte-unchanged source lockfile made the cold version
handoff pass under the original deadline without external connect calls. That
was a fixture omission, not an application fault; the application did not start.

**How to apply:** Include complete project metadata, not only the manifest and
workspace settings, in startup fixtures. Do not strip the first YAML document,
regenerate the lockfile at startup, or infer child-network isolation from
Corepack's flag alone. Keep OS-level isolation and credential-free tracing.
Distinguish archive integrity, project-aware version handoff, and full application
startup; a pass at an earlier stage does not certify a later one.
