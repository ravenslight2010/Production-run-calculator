# Follow-up dependency submission

## Outcome and boundary

**Exact automatic follow-up ordering is unsupported by the exposed proposal
interface.** It accepts a title, description, and category and links the suggestion
to its parent, but exposes neither an explicit dependency list nor sibling aliases.
There is also no exposed operation that atomically reads all unfinished accepted
work and creates parent-linked suggestions from that snapshot.

This document delivers the assigned task's permitted limitation-and-alternative
outcome. It does **not** deliver a platform scheduler change. Repository prose,
editing a local skill, or mentioning dependencies in a task description cannot add
stored dependency edges. Do not pass undocumented arguments or replace an assigned
task's required proposal callback with manual creation.

Two supported alternatives are available:

1. **Dependency-aware manual planning:** when the user explicitly requests a
   planning batch in the main conversation, use the documented manual task creation
   path with explicit dependency refs and sibling aliases. This records the chosen
   dependency set at submission, but is not the generated-follow-up path and does
   not preserve its automatic parent/category metadata.
2. **Sequential approval:** where acceptance is under manual control, leave
   suggestions as Drafts until their prerequisites have finished, then accept one
   sibling at a time. This controls timing, not stored dependencies. If workspace
   settings automatically accept/start suggestions, this alternative is unavailable;
   do not claim that a request to wait stops background work.

Neither alternative proves an atomic creation-time snapshot. Full automatic
compliance requires platform-side controls that this repository cannot implement.
No task settings or existing task dependencies were changed for this outcome.

For repeatable advisory checks before acceptance, use the project-owned
[read-only ordering review](follow-up-ordering-review.md). It separates current
missing links, selected sibling ordering, and retained historical evidence;
it cannot enforce platform scheduling.

## Dependency-aware manual planning

This procedure is for expressly requested manual planning, **not** a workaround
for the assigned-task follow-up instructions.

### 1. Prepare and capture once

- Apply the existing parent/evidence/priority/independent-outcome/overlap checklist.
- Prepare each plan file and choose unique batch aliases in the desired order.
- Read unfinished accepted tasks immediately before submission using
  `queryProjectTasks` with states `PENDING`, `IN_PROGRESS`, `IMPLEMENTED`, `MERGING`,
  and `QUEUED`. The documented base-state filters also include their `MAIN_*`
  variants. Include work that is implemented but not yet merged.
- Exclude unapproved `PROPOSED` Drafts, finished `MERGED` tasks, and `CANCELLED`
  records. Do not reinterpret archived suggestions as user rejection.
- Stop if the read is truncated or the returned task count does not match
  `totalCount`. Use narrower documented filters to obtain a complete inventory;
  never submit from a partial snapshot.
- Retain a receipt with capture time, refs, states, and the chosen dependency lists.
  Omit descriptions, identities, credentials, and unrelated payloads.

There is a race between this read and creation. A task accepted during that interval
could be missed, and a prerequisite could finish. If an exact creation-time snapshot
is mandatory, stop: the exposed tools cannot provide it. For the manual alternative,
coordinate intake during this interval and describe the result as a **pre-submission
snapshot**, not an atomic platform guarantee.

### 2. Submit one explicit batch

The project-task skill documents `bulkCreateProjectTasks`, whose task entries
accept `alias`, `title`, `filePath`, and `dependsOn`. Pass dependency metadata there,
not only in plan text.

Let `B` be the captured set of unfinished accepted refs and `S1 … Sn` be the ordered
batch aliases. Submit:

| Entry | Dependency list |
| --- | --- |
| `S1` | `B` |
| `S2` | `B` plus `S1` |
| `S3` | `B` plus `S1`, `S2` |
| Each later entry | The same `B` plus every earlier batch alias |

The documented manual path permits dependencies on existing accepted tasks and
on siblings in the same batch. It does not permit dependencies on existing
unapproved Drafts outside that batch. Do not create siblings in separate calls and
then rely on linking to their still-unapproved records.

Reuse the same captured `B` throughout the batch. Do not automatically append tasks
created later. Record the parent in each plan as required, but do not claim that
plan text creates the proposal path's `proposedFromRef` or `followUpCategory`.

### 3. Read back before acceptance

For each returned ref, use `getProjectTask` to compare the persisted `dependsOn`
set with `B` plus the resolved earlier sibling refs. Check for extra as well as
missing edges. Retain the returned refs and timestamps alongside the receipt.

If a submission fails or returns an incomplete batch, inspect stored records before
retrying; do not duplicate tasks or repair existing task state without authorization.
An after-creation dependency update is not proof of creation-time compliance and
can race with acceptance.

After authorized acceptance, inspect `queryProjectTasks({ executable: true })` and
the stored dependency/state records. An unfinished prerequisite should keep a
waiting child out of the executable set. After prerequisites finish, a waiting
child should become eligible, subject to platform limits and other blockers. Stop
and report discrepancies; do not force-start work to make the check pass.

These observations require an actual authorized waiting-task case. Draft exclusion
alone does not prove prerequisite blocking. An already-running task is not evidence
of waiting eligibility either. Do not combine exact `taskRefs` and `executable` in
one query; the documented read interface disallows that combination.

The local `QUEUED` state means **queued for merge**, not queued behind execution
prerequisites. UI “Ready” means implemented/ready to merge; it is not synonymous
with the executable query. Status reads do not assign work or authorize this agent
to begin another task.

## Retained verification — 2026-10-02

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

For exact automatic compliance, platform support must expose parent-linked,
dependency-aware creation with a server-side accepted-work snapshot and sibling
sequencing. Until that capability is available, use the manual-planning alternative
only when explicitly requested, or sequential approval when settings allow it.
Do not claim automatic ordering has been fixed.