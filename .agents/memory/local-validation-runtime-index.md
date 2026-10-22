---
name: Local validation runtime index
description: Pointers for the release runner, pinned Node, local browser transport and test certificates.
---

- [Runner locks](release-runner-lock-history.md) — local lock history is private, not platform task history.
- [Pinned Node](pinned-node-nix-runner.md) — use the exact installed Node when provisioning fails.
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
