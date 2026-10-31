---
name: pnpm 12 lockfile provenance
description: How to interpret two-document pnpm lockfiles and preserve revision-bound evaluation history.
---

## Running the pinned manager in Replit

If the Nix-provided pnpm repeatedly bootstraps the repository's newer pinned pnpm and exhausts worker threads, use Corepack's pinned manager instead of lowering the workspace engine requirement.

**Why:** The older system manager can recursively invoke its own bootstrap, while `corepack pnpm` resolves the repository's required version successfully.

**How to apply:** Verify `corepack pnpm --version`. For scripts that spawn bare `pnpm`, create Corepack pnpm shims in a private temporary directory and prepend it to that invocation's PATH. Keep the repository pin, engine checks, and lockfile unchanged.

pnpm 12 records its own pinned binary in a first, environment YAML document. The project's application dependency graph is in the last YAML document. Consumers that extract package or snapshot inventory must read the last document, not the first occurrence of a section. Security tools that audit everything installed must account for both.

**Why:** A first-section reader can silently inspect pnpm's platform binaries instead of the application packages. The lockfile's byte hash also changes as soon as the manager pin changes, even if no application dependency version moves. Retained historical evaluation reports record the lockfile that existed when they ran; rewriting their dependency hash would misrepresent their provenance.

**How to apply:** Update current canonical snapshots bound to lockfile bytes after a manager change. In comparisons to retained historical reports, allow their old lock hash to remain historical while checking the other measured content; never replace the historical report's hash with the current one.

Lockfile-only dependency refreshes can also normalize optional peer bindings and remove stale peer-context snapshots in otherwise unrelated importers. Keep those changes resolver-generated and verify with a frozen install rather than hand-editing a partial peer graph.

**Why:** Optional peer contexts are part of pnpm's lockfile graph, so restoring isolated importer references without their snapshot can create a graph that appears tidy but is not reproducible.

**How to apply:** After a narrow dependency refresh, review lockfile changes for unrelated package-version movement. If only optional peer bindings/snapshots were normalized, preserve the resolver's complete graph and confirm it with `pnpm install --frozen-lockfile`.

A frozen install with `--strict-peer-dependencies` is not by itself proof that an existing lockfile's installed graph has no peer mismatch. When pnpm skips lockfile resolution, that install can succeed despite an unsupported peer; run `pnpm peers` independently to audit the installed graph.

**Why:** A disposable pnpm 12.8.1 probe accepted a frozen strict-peer install from a lockfile containing TypeScript 7 with TypeDoc's TypeScript 6-only peer, while `pnpm peers` rejected the same installed graph.

**How to apply:** In toolchain checks where peer compatibility is a gate, run `pnpm peers` after the frozen install. Do not weaken peer metadata or treat a successful frozen install as a substitute for the audit.

An `add` or targeted upgrade can also advance an unrelated compatible transitive package while regenerating the lockfile. For strict single-dependency work, compare package versions and snapshot edges against the starting lockfile, restore unrelated resolutions, and prove the result with a frozen install.

**Why:** A successful install can still introduce unrelated version movement (for example, a previously locked `lru-cache` resolution), even when the package manifest diff is limited to one dependency.

**How to apply:** Inspect the full lockfile diff after every focused package-manager update; do not infer a narrow resolution from the narrow manifest edit.