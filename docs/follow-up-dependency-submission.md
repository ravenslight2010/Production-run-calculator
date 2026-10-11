# Future-task dependency submission

## Intended rule and supported boundary

Clicking Accept establishes precedence for **all future tasks**: manually planned
tasks, generated follow-ups of every category (`incomplete_scope`, `next_steps`,
`tech_debt`, `test_gaps`, `custom_analytics`), standalone suggestions, main-workspace
work, and isolated task agents. Acceptance order is primary; lower task number
breaks only a verified acceptance-order tie, such as batch acceptance. Compare
numeric task refs numerically, not lexicographically (`#9` before `#10`).
An older draft accepted after a newer task waits behind that newer task, not the
reverse. Creation time and task number never override known acceptance order.

Each future task must have every unfinished task accepted earlier persisted in
`dependsOn` before substantive execution, including lower-numbered members of a
verified acceptance tie. Unapproved drafts do not block work; accepted work
awaiting merge remains unfinished; merged or archived work does not block.
Later acceptances are not retroactively added as ordering dependencies.
Preserve genuine prerequisite dependencies rather than erasing them: a real
technical dependency can exist independently of acceptance precedence. If genuine
dependencies conflict with that precedence or form a cycle, report the conflict
and stop; do not remove edges or silently reverse the acceptance rule.

This revision is **future-only**. The user handles existing tasks. Do not change
any current task record, dependency, scope, acceptance, assignment, or automation
setting to apply it.

| Protection | What is supported here |
| --- | --- |
| Intended ordering | Repository guidance for every future intake and execution path |
| Persisted dependency recording | Documented manual creation with explicit refs/batch aliases; authorized manual updates replace the full list |
| Advisory verification | Complete inventory, reliable acceptance provenance, stored-link readback, and explicit blocker reporting |
| Atomic platform enforcement | Unavailable: no exposed acceptance hook, acceptance sequence, atomic accepted-work snapshot, or automatic agent suspension |

The documented task reads expose `createdAt` and `updatedAt`, **not** a reliable
acceptance sequence. Creation/update timestamps are not acceptance evidence;
unknown acceptance order stays unknown. Do not invent `acceptedAt`, an acceptance
event API, or a scheduler control. Official lifecycle documentation describes
dependency waiting generally, not this workspace's acceptance capture or ordering.
Generated proposals accept title, description, category, and an automatic parent
link, but no dependency lists or sibling aliases. A parent link is insufficient.
Standalone proposals have the same input limitation.

An advisory agent check cannot intercept acceptance or pause platform execution.
Documentation or a passing checker does not enforce scheduling. Plan text does not
create stored edges. Do not edit platform-provided skills, pass undocumented
arguments, or replace required generated proposals with manual creation.

## Startup procedure — before substantive execution

Before substantive execution, read a complete inventory and reliable acceptance-order evidence, verify every unfinished task accepted earlier is a persisted prerequisite, and wait for those prerequisites to finish.
Missing evidence, missing dependency links, or unfinished prerequisites produce an explicit blocked/advisory outcome, not a claim of compliant execution.

This applies in both the main workspace and isolated future task agents, even
if the platform has already launched the agent. Reading records and reporting a
blocker is preparatory work; implementation and substantive investigation wait.

1. **Capture a complete inventory.** Read `queryProjectTasks` using all five
   unfinished accepted base states: `PENDING`, `IN_PROGRESS`, `IMPLEMENTED`,
   `MERGING`, `QUEUED` (base filters include `MAIN_*`). Include the target through
   `getProjectTask`, and read every genuine prerequisite's current record.
   Require `truncated: false` and returned count equal to `totalCount` for each
   shard; de-duplicate refs and check state/filter consistency. If any shard is
   incomplete, stop: there is no documented pagination cursor. Search snippets,
   conversation snapshots, `createdSince`, or `updatedSince` cannot prove completeness.
   State changes during these non-atomic reads require a coordinated fresh capture.
2. **Establish acceptance provenance.** Require reliable evidence of the target's
   acceptance and its relation to every unfinished accepted task. Use a
   platform acceptance-event sequence if one becomes documented/available, or
   explicit owner-attested sequential/batch acceptance receipts that cover the
   relevant intake window. An intended order, planned batch aliases, equal
   creation/update times, or state labels alone prove neither order nor a tie.
   Missing acceptance evidence produces `BLOCKED — acceptance order unknown`,
   never a fallback to creation time or task number. A tie must be positively
   verified before comparing numeric refs.
3. **Verify persisted prerequisites.** Derive earlier unfinished refs (including
   numeric predecessors in verified ties), then inspect the target's `dependsOn`
   via `getProjectTask`. Verify every required ref is stored directly and preserve
   genuine prerequisite links. Missing links produce `BLOCKED — missing persisted
   prerequisites`; description text and a transitive parent link are not substitutes.
   Flag unexplained later-only ordering edges without deleting them.
4. **Wait and report honestly.** Unfinished prerequisites, including implemented
   work awaiting merge, produce `BLOCKED — prerequisites unfinished`, with refs
   and states. Unknown genuine prerequisite states also block. Do not proceed
   substantively, claim compliant execution, force-start, or repair records without
   authorization. State explicitly that this is an **advisory agent stop**, not a
   paused scheduler or suspended background agent. Name the owner's next action:
   provide missing provenance, coordinate authorized dependency recording, or finish
   prerequisites. On explicit resume, reread records and provenance; later
   acceptances do not change the target's acceptance position.
5. **Record a bounded outcome.** Only complete evidence, persisted required links,
   and finished genuine prerequisites permit `ADVISORY — startup checks satisfied`.
   This is not proof of platform scheduling. Retain capture time, source/attestation
   kind, covered intake window and completeness, target/ref/state pairs, acceptance
   sequence or verified tie groups, stored/required/genuine dependency refs, outcome,
   and next action. Do not retain raw plans, personal identities, credentials, or
   unrelated payloads. Capture time is not acceptance time; do not fabricate times
   for owner attestations. Store receipts in a project-local review location only
   until the owner finishes reviewing that startup outcome, then remove them;
   replace obsolete captures rather than accumulating raw task history. Shard
   large receipts with explicit coverage/count metadata; never truncate a receipt
   and still call its inventory complete.

The existing [read-only ordering review](follow-up-ordering-review.md) checks
selected sibling links and historical creation captures. Its inputs do not carry
reliable acceptance-order evidence. Use it only as supplementary link evidence,
not as this startup procedure or an acceptance-order decision engine. Its
implementation and capture comparison remain unchanged by this policy revision.

## Dependency-aware manual planning

This procedure is for expressly requested manual planning, **not** a workaround
for the assigned-task follow-up instructions.

### 1. Prepare and coordinate acceptance

- Apply the existing parent/evidence/priority/independent-outcome/overlap checklist.
- Prepare each plan file and choose unique batch aliases. Alias/list order is a
  proposed order, not acceptance evidence.
- Read unfinished accepted tasks immediately before submission using
  `queryProjectTasks` with states `PENDING`, `IN_PROGRESS`, `IMPLEMENTED`, `MERGING`,
  and `QUEUED`. The documented base-state filters also include their `MAIN_*`
  variants. Include work that is implemented but not yet merged.
- Exclude unapproved `PROPOSED` Drafts, finished `MERGED` tasks, and `CANCELLED`
  records. Do not reinterpret archived suggestions as user rejection.
- Stop if the read is truncated or the returned task count does not match
  `totalCount`. Use narrower documented filters to obtain a complete inventory;
  never submit from a partial snapshot.
- Establish acceptance provenance as in the startup procedure; retain bounded
  receipts for the existing accepted set and planned acceptance window. Missing
  evidence is a blocker even when all task records have creation/update timestamps.

There is a **read/create race**, followed by another interval before acceptance.
A task accepted in either interval could become an earlier prerequisite. Coordinate
intake with the user across both intervals and verify again before execution.
Describe the read as a **pre-submission snapshot**, not an atomic acceptance
snapshot. If atomic capture is mandatory, stop: the exposed controls cannot provide it.

### 2. Submit one explicit batch

The project-task skill documents `bulkCreateProjectTasks`, whose task entries
accept `alias`, `title`, `filePath`, and `dependsOn`. Pass dependency metadata there,
not only in plan text.

Let `B` be the verified existing unfinished accepted set, unioned with genuine
prerequisites for each entry. Record it through `dependsOn`. Batch aliases can
express genuine prerequisites or an owner-coordinated sequential acceptance plan,
but cannot assert that acceptance has already happened.

| Entry | Dependency list |
| --- | --- |
| Entry accepted first under coordinated sequential acceptance | Its `B` |
| Entry accepted next | Its `B` plus earlier accepted batch entries |
| Verified simultaneous batch acceptance | Its `B` plus lower numeric refs in the tie |

The documented manual path permits dependencies on existing accepted tasks and
on siblings in the same batch. It does not permit dependencies on existing
unapproved Drafts outside that batch. Do not create siblings in separate calls and
then rely on linking to their still-unapproved records.

For sequential acceptance, same-call aliases can pre-record the agreed chain;
accept only in that order and attest actual acceptance afterward. The returned
refs are not known beforehand: do not claim alias order predicts numeric tie order.
For a simultaneous acceptance, numeric refs and a verified tie must be available
to verify or, with explicit authorization, record the necessary links before work.
If the controls cannot safely do that, use one-at-a-time acceptance instead.
Never treat submission as acceptance or append later acceptances retroactively.
Record the parent in each plan, but do not claim that plan text creates
`proposedFromRef` or `followUpCategory`.

### 3. Read back before acceptance

For each returned ref, read `getProjectTask` and compare persisted `dependsOn` with
the intended explicit lists. After acceptance, verify again against actual
acceptance provenance using the startup procedure, not merely the planned chain.
Check extra as well as missing edges, preserving genuine prerequisites.

If a submission fails or returns an incomplete batch, inspect stored records before
retrying; do not duplicate tasks or repair existing task state without authorization.
Authorized updates use `updateProjectTask({ taskRef, dependsOn })`, which replaces
the full list: union required ordering refs with all genuine existing prerequisites.
This supported manual operation can race with launch; it is not an acceptance hook
and cannot pause execution. If safe coordination is unavailable, report blocked.
No such updates to existing tasks are authorized by this policy task.

After authorized acceptance, inspect `queryProjectTasks({ executable: true })` and
the stored dependency/state records. An unfinished prerequisite should keep a
waiting child out of the executable set. After prerequisites finish, a waiting
child should become eligible, subject to platform limits and other blockers. Stop
and report discrepancies; do not force-start work to make the check pass.

These observations require an actual authorized waiting-task case. Draft exclusion
alone does not prove prerequisite blocking. An already-running task is not evidence
of waiting eligibility either. Do not combine exact `taskRefs` and `executable` in
one query; the documented read interface disallows that combination.

### User-coordinated sequential acceptance

Where manual acceptance is available, keep future suggestions as Drafts until
earlier accepted work has merged or been archived; accept one at a time and retain
an explicit owner attestation of that sequence. This limits overlap but does not
record missing dependency edges or capture acceptance automatically. Verify the
startup procedure in either execution workspace. If settings automatically
accept/start work, this timing alternative is unavailable; do not change settings
or claim that a request to wait stops background execution.

The local `QUEUED` state means **queued for merge**, not queued behind execution
prerequisites. UI “Ready” means implemented/ready to merge; it is not synonymous
with the executable query. Status reads do not assign work or authorize this agent
to begin another task.

## Current repository verification — 2026-10-05

- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check:task-policy`.
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run test:task-policy`:
  113 wording-contract tests and 15 unchanged read-only reviewer tests.
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check-operational-skill-evidence`.
- **PASS:** `git diff --check`.

The expanded wording contracts check all three policy/procedure documents,
including missing rules and contradictory creation-first, generated-only,
number-first, fabricated acceptance, and scheduling-enforcement claims. Prose
fixtures cover acceptance overriding task number, verified numeric ties, drafts,
awaiting merge, later acceptances, incomplete inventories, missing provenance,
and preserved genuine prerequisites. These are **not pure eligibility decision
tests**: no new decision engine, competing reviewer, or platform integration was
implemented. The existing reviewer's creation-history tests remain historical
supplementary checks, not acceptance-order tests.

No task mutation or settings operation was used during this implementation.
Existing task scope, dependencies, acceptance, assignment, and automation were
left unchanged; this statement concerns this agent's actions, not a claim that
other actors could not update the board concurrently. Application UI/API,
database, sync, release workflows, and runtime configuration were not changed.
Desktop, phone, tablet portrait/landscape, Chromium, WebKit, and physical-device
checks are **not applicable** to repository guidance; no application restart or
browser test is needed.

Acceptance capture, automatic waiting, and atomic scheduler enforcement are
**unsupported/unverified**, not passing checks. No new task is proposed for these
same-objective platform limitations; existing downstream work is unchanged.

### Configured completion-check ledger

The automatic completion attempt also ran broad application/release checks.
They did not all pass; this is not a release-readiness approval.
All commands below use the `bash scripts/src/run-release-node.sh` prefix.

| Command | Observed outcome |
| --- | --- |
| `pnpm --filter @workspace/api-server run test` | **FAIL:** existing `importOperations.integration.test.ts` parse error at line 303; 155 other files and 1778 tests passed. That file is unchanged by this task. |
| `pnpm run typecheck` | **FAIL:** syntax errors in the same unchanged API test; the scripts package typecheck passed. |
| `pnpm --filter @workspace/scripts run check:release-evidence` | **FAIL:** incomplete retained release checkpoint. |
| `pnpm run release:check` | **BLOCKED/exit 1:** requires `--readiness-deployment-id` and `--deployed-revision`, absent from the configured command. |
| `pnpm run release:check:full` | **BLOCKED/exit 1:** same missing required deployment/revision inputs. |
| `bash scripts/src/run-isolated-browser-suite.sh` | **NOT REACHED/exit 1:** web server build identity incomplete/stale; suite did not start, with zero cases discovered. Disposable database cleaned up. |

Client budget, production rules, inventory math, scheduled recipe, spec export,
and Gemini benchmark checks passed in that attempt; production dependency audit
reported no known vulnerabilities. The focused policy checks above remain passing.
Application test repair, release evidence regeneration, publishing/build identity,
and release input/configuration changes are explicitly outside this objective.
Completion is requested with a documented broad-validation exception rather than
rerunning these uncorrected checks or presenting them as passes. The next action
for a complete application/release validation is to repair the unchanged API test
under its owner and supply matching build/release evidence and required inputs.

## Retained verification — 2026-10-02

**Historical evidence under the superseded creation-time/generated-child policy.**
The observations and validation ledger below are preserved, not current
acceptance-order proof. They contain no reliable acceptance sequence.

Source: live task-management callbacks in the isolated assigned-task workspace,
read between 22:59:43 and 23:00:03 UTC, plus earlier reads in the same session.
Repository base revision: `a37ccf16ade83ae3cdcb9b2c3d63afd160a27f27`.
The task service's own build/revision identity is unknown. These are task-platform
records, not application database fixtures or production-application evidence.
Only relevant refs, states, times, and dependency lists are retained below; raw
plans, identities, secrets, and payloads are omitted.

| Observation | Persisted result | Conclusion |
| --- | --- | --- |
| Earlier generated siblings #2639 / #2640 | Same creation time, `dependsOn: ["#2601"]` for each | No sibling edge; both are now merged. Their earlier concurrent execution is recorded in the parent audit, not reconstructed from today's state. |
| Later generated siblings #2650 / #2651 / #2652 | Created at `22:08:10.233Z`; each depends only on #2649; each was `IN_PROGRESS` in the live read | Parent-only edges do not serialize these siblings. |
| Existing owner #2646, read twice | `["#2617", "#2639", "#2640", "#2636"]` both times | Dependencies persisted unchanged across these reads. Newer tasks are absent; this is an observation, not a universal immutability guarantee. |
| Pre-proposal accepted-work inventory at `22:59:43.225Z` | 9 tasks: #2646, #2648, #2650–#2656; all `IN_PROGRESS`; `truncated: false` | Complete observed pre-submission snapshot. No unapproved Drafts were included. |
| Genuine follow-up #2657 submitted at `22:59:43.505Z`, then read back | `PROPOSED`, parent #2646, `dependsOn: ["#2646"]` | The supported proposal retained its parent but omitted the other 8 observed unfinished accepted tasks. No unsupported dependency parameters were supplied. |
| Executable query after submission | 0 tasks, `truncated: false` | The unapproved suggestion was not executable. This does not prove dependency-based waiting. |
| Waiting accepted-task query after submission | 0 `PENDING` tasks, `truncated: false` | No authorized waiting child was available to verify blocked-to-eligible scheduling. No artificial tasks were created or accepted for a scheduler test. |

The eight refs omitted from #2657 are #2648 and #2650–#2656. The 280 ms gap between
snapshot and submission is not an atomic read/create transaction. The retained
evidence proves the chosen proposal path did not record that observed snapshot;
it does not establish lifecycle transitions inside the gap.

### Acceptance results

- **Unsupported:** attaching all accepted-work dependencies or a sibling chain
  through the generated-proposal input. The live readback confirms parent-only
  persistence for the genuine suggestion.
- **Supported alternative, documented only:** explicit manual dependency lists
  and same-batch aliases. No manual test batch was submitted, because there was no
  separately requested planning batch; automatic parent metadata is not promised.
- **Observed:** Draft not executable; older persisted edges unchanged across reads;
  multiple existing generated siblings lack ordering edges.
- **Not verified:** dependency-based waiting-to-eligible transitions, atomic
  creation-time snapshots, universal no-retroactive-update behavior, and automation
  settings. These are limitations, not passing checks.

Application code, schema, data, authorization, and sync behavior were not changed.
Desktop, phone, tablet portrait/landscape, Chromium, WebKit, and physical-device
checks are **not applicable**: the changed surface is agent guidance/documentation,
not the application's UI or the platform's task-board implementation.

### Repository validation

- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run test:task-policy` — 41 tests passed.
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check:task-policy`.
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check-operational-skill-evidence`.
- **PASS:** `git diff --check`.

These checks protect repository guidance; they do not validate platform scheduling.
Focused verification required no application workflow restart because no
application code, dependencies, or runtime configuration changed.

### Broader completion-validation ledger

The completion process subsequently launched the configured broad checks. Its
polling window expired before the browser command finished, so the task was not
marked complete by that attempt. The browser command later ended with a failure.
These outcomes are retained rather than represented as passing validation:

| Configured command (all prefixed with `bash scripts/src/run-release-node.sh`) | Outcome |
| --- | --- |
| `pnpm --filter @workspace/api-server run test` | **FAIL:** exit 1; retained output contains no underlying test diagnostic. |
| `pnpm --filter @workspace/run-calculator run test:budget` | **PASS.** |
| `pnpm --filter @workspace/production-rules run test` | **FAIL:** exit 1; retained output contains no underlying test diagnostic. |
| `pnpm --filter @workspace/inventory-math run test` | **FAIL:** exit 1; retained output contains no underlying test diagnostic. |
| `pnpm --filter @workspace/scheduled-recipe-check run test` | **PASS.** |
| `pnpm --filter @workspace/spec-export run test` | **FAIL:** worker creation failed with `EAGAIN`; no tests ran. |
| `python3 scripts/test_gemini_skill_trigger_benchmark.py` | **PASS.** |
| `pnpm --filter @workspace/scripts run check-model-bump` | **FAIL:** nested isolated-browser fixture attempted to enter the nonexistent `scripts/artifacts/run-calculator` path. |
| `pnpm --filter @workspace/scripts run check-operational-skill-evidence` | **FAIL in broad run:** native package-manager thread-pool panic, exit 134. The same focused command had already passed. |
| `pnpm run typecheck` | **FAIL:** could not spawn the shell-inventory script; resource temporarily unavailable. |
| `pnpm run audit:prod` | **FAIL:** `EAGAIN` while spawning the pinned runtime. |
| `pnpm --filter @workspace/scripts run check:release-evidence` | **FAIL:** incomplete release checkpoint, not valid retained release evidence. |
| `pnpm run release:check` | **FAIL:** requires `--readiness-deployment-id` and `--deployed-revision`, absent from the configured command. |
| `pnpm run release:check:full` | **FAIL:** package-manager process spawn failed with `EAGAIN`. |
| `bash scripts/src/run-isolated-browser-suite.sh` | **FAIL:** 123 passed, 1 failed, 46 did not run. Failure: `e2e/recipe-refresh-start-freeze.spec.ts:1396:3`, “mix recipe edits refresh pending runs across browsers but freeze after Start”. |

Evidence source: completion command logs read after the run; only bounded outcomes
are retained here, not raw browser state or operational payloads. These unrelated
application, release-input, and validation-environment failures were not repaired
under the task-platform limitation/documentation objective. The configured broad
validation could not complete successfully in this setup; a completion exception
is requested with this ledger intact. This is not a release-readiness approval.

## Evidence sources and next action

- `.local/skills/follow-up-tasks/SKILL.md`: generated proposal input and assigned-task
  parent-link requirement.
- `.local/skills/project-tasks/SKILL.md`: explicit manual dependencies, batch aliases,
  read filters, state semantics, and executable-query limits.
- Live `getProjectTask` / `queryProjectTasks` readbacks above and the parent audit
  task #2617. The parent plan was read from the task service because its local plan
  file was absent.
- Official [Follow-up tasks](https://docs.replit.com/features/agent/follow-up-tasks),
  [Task board](https://docs.replit.com/features/agent/task-board), and
  [Task lifecycle](https://docs.replit.com/features/agent/task-lifecycle) documentation,
  consulted through Replit's documentation search. General lifecycle descriptions
  do not prove this workspace's dependency snapshot or sibling ordering.

For exact automatic acceptance-order compliance, platform support must expose
reliable acceptance-event capture, atomic prerequisite recording at acceptance
across all task origins, and enforced waiting before substantive execution.
Until then, use authorized manual dependency recording and owner-coordinated
acceptance where available, with explicit advisory blockers otherwise. No current
task records or settings were changed. Do not claim automatic ordering is fixed.