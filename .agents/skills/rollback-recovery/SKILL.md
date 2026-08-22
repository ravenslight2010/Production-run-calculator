---
name: rollback-recovery
description: Safely recover missing or regressed behavior after a rollback, checkpoint comparison, rebase, or partial restore. Use whenever the user mentions a checkpoint, rollback, restore, recovery, parity audit, missing post-merge behavior, or divergent historical implementation. Preserve a named baseline, run the repository recovery audit, restore incrementally, and require evidence before declaring recovery complete; never replace the current branch wholesale.
---

# Rollback Recovery

Use this skill for selective recovery from a checkpoint, divergent branch, rebase, or
partial restoration. The goal is to recover genuinely missing behavior while preserving
the current branch's intentional improvements. A checkpoint is evidence to compare
against, not an instruction to reset the branch.

## Boundaries

This skill does not automatically reset Git history, merge a checkpoint, replace a
large application file wholesale, run a data heal, or publish a release. It coordinates
those decisions and routes specialized risks to the skills that own them.

Do not use it for:

- an ordinary bug fix with no historical recovery or parity question;
- a user who only wants to inspect a checkpoint without changing the current tree;
- a release-only request (use `release-checklist`);
- a specific import, sync, schema, state-accuracy, or poisoned-data issue when no
  recovery comparison is involved (use the specialist skill directly).

## Required operating principles

1. **Protect before editing.** Confirm the working tree state and create one named,
   protected baseline reference at the current `HEAD` before making changes.
2. **Audit before restoring.** Run the checked-in recovery audit against the current
   tree and read its manifest. Do not infer gaps from a checkpoint diff alone.
3. **Recover selectively.** Restore only a feature classified as missing or concretely
   regressed. Keep current behavior unless evidence shows it is broken.
4. **Preserve contracts.** A recovered route or persisted behavior is incomplete until
   its schema/OpenAPI/generated client, wiring, tests, and runtime path are accounted
   for when applicable.
5. **Leave an evidence trail.** Every intentional difference and every omitted candidate
   needs a short rationale in the recovery record or final report.
6. **Prefer reversible edits.** Avoid destructive history or data operations. Stop and
   ask for explicit direction before a schema drop, broad data rewrite, or production
   change.

## Recovery workflow

### 1. Establish scope and the protected baseline

Capture:

- the user's expected behavior and the recovery source (checkpoint, branch, tag, or
  prior release);
- the current branch, commit, working-tree status, and any uncommitted work;
- the files, feature area, roles, devices, and environments in scope.

Before editing, create a named local reference without changing the branch:

```sh
git status --short
git branch recovery-baseline-<name> HEAD
git tag recovery-baseline-<name> HEAD
```

Use one stable name in commands and the final report. If the tree is dirty, do not
silently include unrelated edits in the recovery; record them and keep the baseline
clear. If the reference cannot be created, stop before making changes.

Inspect the checkpoint history and compare focused paths. Prefer manifest entries and
small diffs to copying an entire historical commit:

```sh
git log --oneline --decorate --all -- <relevant-path>
git diff --stat <checkpoint>...HEAD
git diff <checkpoint>...HEAD -- <relevant-path>
```

### 2. Run the recovery audit first

Locate the repository's checked-in recovery manifest and read its audit instructions.
Run the existing audit in normal and machine-readable modes when available (in this
repository these are `pnpm run audit:recovery` and the scripts package's `--json`
variant). The audit is read-only and must not be replaced by an ad hoc script.

Classify each entry:

- **PASS / present:** declared source and evidence exist;
- **MISSING:** one or more declared files, wiring, contracts, or tests are absent;
- **DIFFERENT / intentional difference:** evidence differs or is incomplete, but a
  written rationale says why the current implementation is intentionally preferable
  or equivalent.

Treat `MISSING` as an investigation lead, not automatic permission to restore. Confirm
whether the candidate is already represented by a completed, active, or proposed task
and whether current runtime behavior actually fails.

### 3. Check for duplicate work

Search the project task queue using the feature's user-facing terms, failure mode, and
relevant paths. Inspect matching active, proposed, ready, and completed task records;
do not only compare titles. Also search the repository for existing routes, handlers,
tests, generated contracts, and specialist skills.

Classify the candidate as one of:

- **Already covered:** no recovery work; cite the current implementation or test.
- **Existing task:** do not create duplicate work; coordinate with or reference the
  existing task, unless this recovery supplies a concrete missing regression.
- **Recovery candidate:** no duplicate and current behavior is demonstrably absent or
  regressed; continue with a bounded restoration.
- **Intentional difference:** current behavior differs but satisfies the requirement;
  record the rationale and evidence rather than forcing historical parity.

Never treat a missing manifest file as proof that the feature should be restored. A
manifest can be stale, and a current implementation may live at a different path.
Likewise, do not mark a difference intentional merely because the code compiles:
explain the preserved behavior and verify its acceptance boundary.

### 4. Distinguish missing behavior from intentional difference

For each candidate, make a short comparison table:

| Question | Evidence to collect |
| --- | --- |
| Was the behavior present in the recovery source? | focused diff/history and source |
| Is equivalent behavior present now? | current source, route registration, UI wiring |
| Does the public contract still expose it? | schema/OpenAPI/generated declarations |
| Is it protected? | focused unit/integration/browser test |
| Does the user-facing/runtime path work? | preview, API request, or operational result |
| If different, why is the current version intentional? | requirement, newer task, regression fix, or reviewed scope note |

Use **missing** when the current tree cannot satisfy the behavior or its required
boundary is absent. Use **intentional difference** when the current behavior satisfies
the requirement with a deliberate, documented variation. If the evidence is
ambiguous, do not restore or declare parity; stop with the ambiguity and ask for the
smallest missing fact.

### 5. Route specialist risks before implementation

Read and follow the specialist skill in addition to this one when its trigger applies:

- `schema-change-checklist` — any new or changed persisted field, table, migration,
  or database contract;
- `sync-invariant-check` — day-state, sync routes, SSE, LWW stamps, tombstones,
  reset epochs, wake recovery, or cross-device adoption;
- `spec-import-guard` and `import-bug-investigation` — spec, premix, cheese, shipping,
  aliases, saved parses, or import linking;
- `data-heal-playbook` — incorrect values may already be stored, or recovery includes
  a repair/heal;
- `state-accuracy-check` — timers, counters, auto-track, pause/resume, or live state;
- `release-checklist` — publish/release claims, workflow health, generated artifacts,
  deployment, or production-facing validation;
- `test-gap-triage` — the right regression layer or an existing test/task is unclear.

The specialist checklist remains authoritative for its invariants. Do not weaken it
to make historical recovery easier.

### 6. Restore incrementally

For a confirmed recovery candidate:

1. Define the smallest behavior slice and its acceptance evidence.
2. Restore source and wiring without wholesale replacement of current files.
3. Update the source contract and regenerate checked-in clients where applicable;
   never hand-edit generated output.
4. Add or adapt focused tests at the first failing boundary.
5. Re-run the recovery audit after each coherent slice.
6. Review the diff against both the protected baseline and the recovery source.

Keep recovery commits or edits easy to inspect and revert. Do not broaden the work
to unrelated historical differences. If restoration reveals a schema migration,
poisoned data, sync risk, or production concern, pause and complete the routed
specialist workflow before continuing.

## Stop conditions

Stop implementation and report the blocker when:

- the named baseline was not preserved;
- the recovery source or expected behavior is ambiguous;
- the audit cannot run, the manifest is invalid, or missing evidence cannot be explained;
- a candidate overlaps an existing task and ownership/scope is unclear;
- current and historical behavior differ without enough evidence to call it intentional;
- the change would require wholesale file replacement, destructive Git history, a schema
  drop, a broad data rewrite, or production data changes;
- required contract, focused-test, specialist, or runtime evidence is unavailable;
- a destructive browser/integration setup cannot prove disposable database isolation.

Do not call a blocked or partially investigated recovery complete. State the exact
missing decision or evidence and the smallest safe next step.

## Completion evidence

Before declaring recovery complete, verify all applicable layers:

- **Source:** the recovered behavior and its route/component/helper wiring are present;
- **Contract:** schema, API/OpenAPI, generated clients, and serialization agree when
  the behavior crosses a process boundary;
- **Tests:** focused tests cover the restored invariant and relevant role/device path;
- **Runtime:** the owning workflow starts cleanly and the changed API or UI path works
  through the real preview/runtime boundary;
- **Audit:** the recovery manifest reports no unexplained `MISSING` entries; every
  `DIFFERENT` entry has a rationale;
- **Safety:** no unapproved production data change, destructive setup, or hidden
  one-time heal was introduced.

### Partial-recovery simulation

Use this sanity scenario to validate the workflow mentally or in a disposable fixture:

> The checkpoint has a report route, generated contract, and report test. The current
> branch has the route and contract, but the test is missing; its UI includes an extra
> source-unavailable note that is not in the checkpoint.

Expected handling:

1. Preserve a named baseline and run the audit.
2. Classify the missing test evidence as an investigation candidate, not a reason to
   reset or copy the checkpoint.
3. Check for an existing report/recovery task and current runtime behavior.
4. Treat the extra UI note as an intentional difference only after confirming it is
   deliberate and compatible; record why.
5. Add the smallest focused regression test if no duplicate task owns it.
6. Re-run the audit and collect source, contract, test, and runtime evidence.

## User-facing completion report

Use this compact format and do not claim production changes unless they occurred:

```text
Recovery: <checkpoint/rollback source>
Baseline: <named branch/tag and commit>
Current: <branch and commit>
Audit: PASS / BLOCKED — <command and summary>

Recovered: <feature IDs and focused files>
Already present: <feature IDs and evidence>
Intentional differences: <feature IDs and rationale>
Left out: <feature IDs and why>

Evidence:
- Source/wiring: <paths or result>
- Contract: <schema/generated result or N/A>
- Tests: <commands and result>
- Runtime: <workflow/API/preview evidence or N/A>
- Specialist checks: <skills and result>

Production changes: none / <explicit description>
Open risks or handoff: <short list, owner, and next safe step>
```