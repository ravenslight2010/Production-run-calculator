# Node 24.21.0 and pnpm 12.8.1 evaluation

**Evaluation date:** 2026-10-04  
**Source revision:** `a37ccf16ade83ae3cdcb9b2c3d63afd160a27f27`  
**Decision:** Do not adopt either pin in this revision.

The toolchain candidates were tested together using Node **24.21.0** and pnpm
**12.8.1**. The candidate Node and pnpm executables ran successfully. With
pnpm's automatic selection of the repository's current package-manager pin
disabled for the trial:

- `pnpm install --frozen-lockfile --ignore-scripts --offline` passed for all
  51 workspace projects.
- `pnpm run typecheck` passed.
- The trial left the tracked lockfile and retained release evidence unchanged.

The release preflight did not pass under Node 24.21.0. Running
`node scripts/src/check-routine-node-version.mjs` with the candidate Node
reported that the actual version was 24.21.0 while retained evidence requires
24.20.0. Both retained evaluation manifests still record Node 24.20.0:

- `docs/second-pass-reviewer-benchmark-2026-09-05.json`
- `release-evidence/ai-evaluations/deterministic-import-corpus.json`

The `.nvmrc` selector and exact Node pins in CI also remain at 24.20.0. The
preflight intentionally rejects a different runtime rather than rewriting old
evidence. No standard or full release run was accepted as candidate evidence;
the candidate must first have freshly measured retained manifests, followed by
the matching revision-bound release checks.

**Node 24.21.0:** The runtime, frozen install, and typecheck worked, but adoption
is rejected for now because the required retained evidence and release checks
are bound to Node 24.20.0.

**pnpm 12.8.1:** The candidate handled the current frozen workspace install and
typecheck, but adoption is also deferred. This task requires a consistent
toolchain proposal and passing release evidence; a package-manager-only
compatibility pass does not establish that. The root `packageManager` field,
lockfile package-manager metadata, container pnpm pin, and release checks must
be updated and evaluated together before adoption.

No Node or pnpm pins were changed. `minimumReleaseAge: 1440` and all 93
workspace overrides remain unchanged. The registry dates and eligibility
observations are documented in
[`dependency-update-inventory-2026-10-02.md`](dependency-update-inventory-2026-10-02.md);
this decision does not promote Node 26 or TypeScript 7.