# Approved upstream integration — 2026-10-31

## Agent-owned execution

**Objective/owner:** Notion AI integrated the refreshed Replit and main histories
into `feat/windows-lan-self-hosting` after Donald explicitly approved that scope.
This is the existing self-hosting objective, not a new deployment/release task.
No merge into main, change to Replit, publication or production-data access.

Captured and integrated tips:

- Replit `024a87633d7c23006dba9a109c0720712d039e9c` — **51 commits** since
  the initial `d0d5699...` baseline, including newer operational, permission,
  retention, provider and validation/bootstrap changes.
- main `486d53b43189c920a3025b3cb90aaf9543e826a2`.
- Initial feature tip `fe2b2b9da91434ffcba4a3cf97959ea8ca4ee20f`.
- Replit integration merge `78202919136a5a3c2be80d1414585d30a7b653d6`
  via [feature-targeted PR #143](https://github.com/ravenslight2010/Production-run-calculator/pull/143).
- Main integration merge `ee5afae5af347450b930dd0161451d53b2339a7d`
  via [feature-targeted PR #144](https://github.com/ravenslight2010/Production-run-calculator/pull/144).

Both captured upstream tips are verified ancestors of the integrated feature
branch. GitHub reports [PR #142](https://github.com/ravenslight2010/Production-run-calculator/pull/142)
mergeable (source conflicts resolved), but CI/qualification is **not all green**
and it remains a draft.

### Conflict resolution and preservation

The Replit merge was clean, retaining the isolated self-host stack and Project
workflow duplicate-launch repair while incorporating the current bootstrap.

The two known main conflicts are the run-template repository and its tests.
Preserved the exact current Replit versions: timeout override/restoration,
real-timer hung-write handling, flush draining, account/generation scopes and
Undo/epoch fences remain intact. A main-derived integration branch first received
this safe resolution; its merge into the feature branch was verified with
`git merge-tree` to have **zero content changes**. No older main implementation
was written over the feature branch. Main ancestry is now recorded properly.

The remote integrated tree was verified **exactly equal** to the local index tree
used for validation, before subsequent documentation-only updates.

## Applicable safeguards and verification

AGENTS.md, task-execution-rules, verify-before-commit and relevant provider,
role/offline-queue/bootstrap memory guidance were applied. No database URL was
used for local server checks; DB-free tests ran with `DATABASE_URL` unset.
No private fixtures/reports, authentication secrets or deployment rights were
retrieved or republished. Missing checks remain failed/blocked, not skipped to
manufacture a passing result. No release/publication gate was weakened.

### Results on the integrated source

Pinned Linux x86_64 tooling: Node **24.21.0**, pnpm **12.8.1**, ShellCheck 0.11.0.

| Check | Result |
| --- | --- |
| Frozen workspace dependency install | PASS |
| Authoritative `CI=true pnpm run typecheck` | PASS, exit 0 |
| Self-hosting safety contracts | PASS, 45 tests |
| Preserved run-template regression suite | PASS, 30 tests |
| Updated local AI adapter suite | PASS, 28 tests |
| DB-free server safeguards (autotrack coordination/ticks, protective run-value merge, AI boundaries) | PASS, 185 tests in four files |
| Workflow policy and actionlint | PASS, 15 workflows |
| Entire calculator Vitest suite | **FAIL**: 3,776 passed, 23 failed, 1 skipped; 386 files passed, 6 failed, 1 skipped |
| Local CI-settings web-build diagnostic | **BLOCKED**: required reviewed build-source inputs are absent |
| New self-hosting CI on integrated code | PASS on Windows and Linux: contracts, Windows parser, Linux Compose config |
| Full GitHub CI | **NOT GREEN**: observed build + department-browser failures; other jobs still running at capture |

All **23 local calculator failures** report `ENOENT` for absent source workbook
files referenced by six existing test modules:

- `brandRenameReimportRealWorkbooks.test.ts`
- `mergeReimportDoughSauceWorkbooks.test.ts`
- `mergeReimportRealWorkbooks.test.ts`
- `specImportBlendTypeAliasSkip.test.ts`
- `specImportCheeseDuplication.test.ts`
- `specReimportRenameMemory.test.ts`

Those source workbooks are not tracked at current Replit. This is **not proof
that the affected functionality passes**, and those tests were not removed,
rewritten against substitute data, or excluded from the result.

Build-source prerequisite evaluation reports `Required build-source inputs are
missing.` The normal reviewed-input restoration path requires an approved
protected source-library report; it is absent from this checkout. Do not restore
it to public Git from historical material, fabricate evidence, bypass source
fingerprinting or disable build checks. Fresh-host builds also need this resolved
before the installer can be qualified.

Observed CI evidence on integrated code:

- [Core CI run](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41201950338)
- [Failed web/API build job](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41201950338/job/124539322546)
- [Failed department journey job](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41201950291/job/124539322112)

Build/department CI failures are observed facts; their complete hosted logs were
not obtained through the available connection, so the local missing-input finding
is **not asserted as the proven cause of every remote failure**. Core CI and
browser/DB/image jobs need final logs/results reviewed before any main merge.

### Owning failure ledger / remaining acceptance

- **Resolved:** local merge preparation initially stopped for missing committer
  identity. Used per-command `Notion AI (local verification)` / local-only identity;
  no user impersonation or global Git identity changes.
- **Resolved:** missing main ancestry / two-file conflicts. Initial temporary
  older-file alignment was blocked before execution. Used a separate already-
  resolved main-derived branch instead; zero feature content change verified.
- **Resolved:** Replit advanced beyond the original baseline. Captured and
  integrated the refreshed tip above, including its binary/history changes.
- **BLOCKED:** workbook-based tests need approved private input provisioning.
  Owner: maintainer + agent, next action establish the authorized private fixture
  delivery path and rerun the complete unchanged suite. Do not commit source
  workbooks into the public repo to fix CI.
- **BLOCKED:** reviewed build inputs and observed hosted build/browser failures.
  Owner: maintainer + agent with approved input/CI-log access; diagnose final
  logs, provide approved inputs or an explicitly reviewed clean-install source
  policy, repair safely and rerun. Do not equate local typecheck to deployability.
- **Not run/blocked, unchanged:** actual Windows Docker/ACL/unattended startup,
  HTTPS trust, desktop/phone/tablet portrait and landscape acceptance, emulated
  Chromium/WebKit and physical Android/iOS Safari/PWA, fresh imports, WAN outage,
  local-model capacity/vision quality, 20-client workload, reset/backup/restore,
  signed artifact publishing and the automatic updater implementation.

**Outcome:** requested source/history integration is complete for the captured
tips. **NO-GO for main merge, deployment or automatic updates** until unresolved
CI, private-input and runtime/qualification gates are closed. PR #142 stays draft.
