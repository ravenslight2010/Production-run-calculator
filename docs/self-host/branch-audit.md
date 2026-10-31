# Branch integration audit

> Historical first-pass record. The approved refreshed Replit/main integration
> is now complete and source conflicts are resolved. Current results and remaining
> CI/input blockers: [2026-10-31 integration report](integration-2026-10-31.md).

## Scope and method

Fetched all **25 pre-existing remote heads** and full ancestry (not a shallow
comparison). Snapshot before this task created its feature branch. Compared each
head against both current `Replit` and `main`, enumerated non-merge commits outside
the union of those histories, inspected changed-path scopes for independent work,
and reviewed relevant run-template, schema conversion, metadata and dependency
patches. This is a source/history review, **not execution of every experiment** or
line-by-line certification of every historical document/binary asset.

- Replit: `d0d5699aa171bd8b3da649a85b6160a3b6cdbc19`.
- main: `486d53b43189c920a3025b3cb90aaf9543e826a2`.
- Replit-only commits: **282**. Main-only commits: **6** (including merges).
- Tip-to-tip difference: **2,220 paths**. New self-host code is deliberately
  isolated; the PR's large inherited application diff comes from selecting
  Replit as requested, not a rewrite of those features.
- The local AI adapter is already shared with Replit. It is not necessary to
  transplant an old main tree to retain that foundation.

`Ahead R/M` below counts each branch's commits not reachable from Replit/main.
`Independent` counts non-merge commits reachable from neither of those baselines.
Counts describe ancestry, not work quality or merge approval.

| Remote branch | Exact head | Ahead R/M | Independent | Decision |
| --- | --- | --- | --- | --- |
| `Replit` | `d0d5699aa171bd8b3da649a85b6160a3b6cdbc19` | 0/282 | 0 | Functional baseline; retain latest application and docs. |
| `agent/windows-metadata-validation` | `eb5905542b703992562a5992b77f36835953d249` | 6/186 | 6 | Defer: distillation metadata tooling on NTFS, not Windows app hosting; keep its fail-closed export boundaries intact. |
| `chore/serial-to-identity` | `60a1c78060aa14b5ec4ed7b3b4c4c0c71e81628c` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `chore/skill-frontmatter-effort` | `51a588f3eb733791bffc787d6966f282494132d5` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `dependabot/npm_and_yarn/chokidar-6.0.0` | `0b55537b86ea8dace10987631ab66192ac895eb2` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/hookform/resolvers-6.0.0` | `ccdbc8f0794171e39b195085b97fb1c0f4ab000d` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/lucide-react-1.61.0` | `aebef20c7563e9315b26b575a297717bb5b5e93e` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/openai-7.42.0` | `e5ac6bed399d736383cf3a34a63b9462dbb65d9b` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/orval-8.44.0` | `f8e04885dc84b2ab739828c5ba3f6b330184462a` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/react-resizable-panels-4.14.8` | `27768e8425544078fc16df6d873d4516ffb99667` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/tanstack/react-query-5.104.5` | `3f970db56bcf67411e479b23ef403984efeffec8` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/typedoc-plugin-markdown-4.14.1` | `20b4df177812fa2ec10443e9443d7f1fc11318f1` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `dependabot/npm_and_yarn/vite-8.3.5` | `f9b0524dc3a201a981b5424aa204bbab0d43bb15` | 8/2 | 2 | Defer version bump + evidence-pin rebind; separate dependency qualification, no self-hosting requirement. |
| `feat/pool-delay-telemetry` | `c427de8a281328d749e049e6b23260acda2603c5` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `fix/a11y-amber-badge-contrast` | `38a9575c760363d46533201f65d7008d0705463e` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `fix/a11y-menu-close-race` | `b54434dc20c16238220720bc302c9c9d3e3a84bc` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `fix/e2e-sleeps-absence-assertions` | `a31f2f6dcb3ea5bc6b260923ccf1cba746fbc5b2` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `fix/run-templates-flush-drain` | `d17dea97528264c40143624080212dc51b05898c` | 5/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `fix/run-templates-timer-margin` | `a698e3b788350a4260d4753bfc497a0ee1a30190` | 2/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `kimi` | `757eb1322a366aafc96be71ddaa5a334da92a410` | 20/278 | 13 | Defer serial/identity + schema/corpus reconciliation pending disposable migration parity rehearsal; do not replace current Replit tip. |
| `kimi-main-reconciliation` | `b9f7d7a5977249508ab0b218c2a8c5f101f57830` | 8/2 | 2 | Run-template reconciliation already represented in current Replit; retain newer scoped safeguards. |
| `kimi-replit-2026-10-27` | `eac1461fae83bb97defd05b0ec5d119732f516b8` | 21/279 | 14 | Defer serial/identity + schema/corpus reconciliation pending disposable migration parity rehearsal; do not replace current Replit tip. |
| `main` | `486d53b43189c920a3025b3cb90aaf9543e826a2` | 6/0 | 0 | Compare six main-only commits / two files; preserve intent via newer Replit implementation and tests. Merge conflicts remain; no merge authorized/performed. |
| `merge/replit-integration` | `70be58f359c396e5454b33974cf956e9f2b91b0e` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |
| `merge/replit-updates` | `f26903f1078f48155ebf5cab18b0560321eddbf9` | 0/0 | 0 | No independent non-merge commits outside main/Replit; historical/merged work, do not replay. |

## Main's two-file difference

Main-only implementation changes affect:

- `artifacts/run-calculator/src/runTemplatesRepository.ts`
- `artifacts/run-calculator/src/runTemplatesRepository.test.ts`

Main adds a test-only timeout override and drains optimistic flushes between
tests. Current Replit already retains the 30-second production timeout, override
restoration tests, real-timer hung-save/delete tests in both scopes, teardown
across scopes, and serialized in-flight edits. It additionally protects account
identity, generation, shared Undo/master-data epochs and authenticated durable
pending intents. The existing 30-test suite passed on this baseline.

Do **not** overwrite Replit with main's older scope-only implementation. Direct
three-way merge has conflicts in both files. The available write API cannot
publish the locally resolved two-parent merge directly. An auxiliary integration
PR #141 was opened, **closed without merging**, and its temporary two-file stage
was restored to Replit. No branch was merged into main or production. Final PR
remains draft and the ancestry/conflict reconciliation remains explicit pending
approval of a feature-branch-only merge; do not present it as merge-ready.

## Experimental choices

- `agent/windows-metadata-validation`: 12 changed paths, six unique non-merge
  commits, chiefly metadata append/recovery locks, PowerShell tooling and tests.
  Its own guide explicitly says this does not establish full-app Windows support.
  Importing it would unnecessarily widen this task and its private-export scope.
- Nine Dependabot heads: individual version/catalog/lockfile changes and retained
  evaluation-manifest bindings. No blind SDK, bundler or form-library upgrade.
- `kimi`: thirteen independent non-merge commits across run-template reconciliation,
  serial-to-identity migration, schema alignment, Docker migration smoke and
  reviewed source-library audit records. The migration takes exclusive locks and
  preserves sequence/grant state; it still needs actual DB parity/rehearsal.
- `kimi-replit-2026-10-27`: includes that work plus audit reconciliation, but its
  tip differs from current Replit in 142 paths and omits newer operational fixes.
  Taking that tip wholesale would not satisfy the requested latest-Replit base.
- `kimi-main-reconciliation`: two independent run-template preservation commits;
  their intended behavior is covered by the newer current Replit implementation.
- Historical `chore/*`, `fix/*`, `feat/pool-delay-telemetry`, `merge/*` heads have
  no independent commits outside the two baselines. Do not replay already-merged
  work because the old branch still exists.

## Recheck before merge

Fetch heads again, check for new commits, resolve the two-file ancestry conflict
without regressing Replit's identity/epoch fences, run the retained regression
suite and CI, review the inherited 282-commit application/source-library diff,
then require the remaining self-host qualification gates. This audit does not
approve a schema migration, protected source-library export, release or deployment.

## Final verification: branch movement during this task

Re-fetch confirmed main unchanged at the recorded tip. Replit advanced by four
commits during implementation to `1bac34a4acf7f916d858e6e072540e9df361e26b`
(142 changed paths, including browser evidence/binary snapshots, operational
sync/autotracking, local provider safeguards and release-tooling changes).
The other 24 pre-existing heads did not move in the final remote-head comparison.
The integration branch is deliberately still pinned to the initial Replit
snapshot; these new changes are **not included or covered by its local check
results**. Do not overwrite them or describe this as latest-Replit reconciled.
Feature-branch-only integration of the new Replit commits and main conflict
resolution, followed by revalidation, remains required before merge readiness.

Published code commit `1f110f4b2e2af839a8d2f39f3b7d6d75df54b51c` passed
[Self-host foundation CI](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/40817896685):
45 pure tests on each of Windows/Linux, Windows PowerShell parse, Linux Docker
Compose configuration validation. This is not a Windows Docker runtime test.
The later documentation-only tip has no full PR CI run; GitHub reports the draft
PR as non-mergeable due to the documented source conflicts.
