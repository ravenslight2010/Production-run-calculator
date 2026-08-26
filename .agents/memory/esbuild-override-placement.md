---
name: Development esbuild override placement
description: Where pnpm applies workspace-wide dependency overrides in this monorepo
---

Pnpm applies the dependency overrides that control transitive advisory remediation from the repository root `package.json`; putting them only in `pnpm-workspace.yaml` does not reliably alter the lockfile graph.

**Why:** A workspace YAML override can look active while `pnpm why` and `pnpm audit` still report the original nested package versions.

**How to apply:** Keep security-critical transitive overrides in the root package manifest, regenerate with pnpm, and verify both the lockfile and `pnpm why` output.