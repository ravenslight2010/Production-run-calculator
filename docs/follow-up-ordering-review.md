# Read-only follow-up ordering review

This project-owned workflow checks stored dependency links **before acceptance**.
It is advisory: it cannot stop automatic acceptance, enforce platform scheduling,
change task settings, accept suggestions, edit dependencies, or assign work.
No application server, database, browser, or credential is needed.

**Acceptance-policy boundary:** this reviewer predates the future acceptance-order
rule. Reviewer-selected sibling order and historical creation captures are not
acceptance provenance. A passing report cannot satisfy the acceptance-order
startup procedure in [Future-task dependency submission](follow-up-dependency-submission.md)
by itself. The reviewer and capture-comparison implementation are unchanged.

Use [the supported alternatives](follow-up-dependency-submission.md) when exact
ordering is required: authorized dependency-aware manual planning, or sequential
approval where manual acceptance is available. A warning does not suspend an
already-running task. Do not automatically repair records from this report.

## Select the review scope

Choose the target refs and their intended sibling order explicitly. The first
ref is the earliest intended sibling. Use one family per review; do not infer
sibling order from equal timestamps or task numbers. Documented task reads do
not promise parent metadata, so the tool does not claim to discover every sibling.
The report covers only the siblings the reviewer selected.

Unapproved Drafts are excluded from the unfinished accepted prerequisite
inventory. They can still be selected as review targets. Missing sibling links
among selected Drafts warn about their **future acceptance**, not their current
execution eligibility. Archived siblings do not block. Merged siblings' stored
links can be reviewed but do not mean there is unfinished work.

## Capture using documented reads

In the agent's callback environment, run this read-only capture recipe. Change
only `orderedRefs` to the family being reviewed. These callbacks are documented
in `.local/skills/project-tasks/SKILL.md`; they are not shell commands, public HTTP
endpoints, or a task SDK to install.

```javascript
const orderedRefs = ["#101", "#102"]; // reviewer-selected intended order
const startedAt = new Date().toISOString();
const clean = t => ({
  taskRef: t.taskRef, state: t.state, createdAt: t.createdAt,
  dependsOn: t.dependsOn
});
const checked = result => {
  if (result.truncated !== false || !Array.isArray(result.tasks)
      || result.totalCount !== result.tasks.length) {
    throw new Error("Incomplete task inventory; stop and recapture.");
  }
  return result.tasks.map(clean);
};
const tasks = [];
for (const state of ["PENDING", "IN_PROGRESS", "IMPLEMENTED", "MERGING", "QUEUED"]) {
  const shard = checked(await queryProjectTasks({ states: [state] }));
  if (shard.some(t => t.state.toUpperCase().replace(/[- ]/g, "_")
      .replace(/^MAIN_/, "") !== state)) {
    throw new Error("State-filter mismatch; stop and recapture.");
  }
  tasks.push(...shard);
}
const targets = [];
for (const taskRef of orderedRefs) {
  targets.push(clean((await getProjectTask({ taskRef })).task));
}
const executable = checked(await queryProjectTasks({ executable: true }));
const capture = {
  version: 1, source: "documented-task-read-callbacks",
  startedAt, capturedAt: new Date().toISOString(),
  current: { tasks, totalCount: tasks.length, truncated: false },
  targets, orderedRefs,
  executable: { tasks: executable, totalCount: executable.length, truncated: false }
};
await writeFile({
  path: ".local/follow-up-review/current.json",
  content: JSON.stringify(capture, null, 2),
  createParents: true
});
```

The module also exports `captureReview({ queryProjectTasks, getProjectTask },
orderedRefs)` for environments that can inject the documented reads. It uses the
same five state queries, exact target reads, and separate executable query; it
does not contain or load mutation callbacks.

Base-state filters include the main-workspace variants. If a state shard is still
truncated, **stop**. The documented interface has no pagination cursor. Do not use
search snippets, time-filtered subsets, the conversation task list, or unchecked
concatenation to declare a complete inventory. Have a reviewer obtain a complete
inventory through supported reads before trying again. The capture is a sequence
of reads, not an atomic snapshot; state changes can require a fresh capture.

Do not combine exact refs with `executable: true`. The executable query is a
separate observation. It does not grant assignment and is not the UI “Ready”
label (implemented/ready to merge). `QUEUED` means queued for merge, not waiting
behind execution prerequisites.

## Run the reviewer command

From the repository root:

```sh
node scripts/src/review-follow-up-ordering.mjs .local/follow-up-review/current.json
```

Or use the package command with an absolute capture path:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run review:follow-up-ordering /absolute/path/to/current.json
```

The command reads JSON and prints an allowlisted JSON report to stdout. It does
not write files or contact the platform. Exit codes: **0** no current-link or
retained-snapshot mismatch warnings; **1** advisory warnings; **2** invalid,
incomplete, or contradictory capture. Exit 0 is **not acceptance approval or
historical compliance**. A shell exit code cannot block automatic acceptance.

Report sections:

- **Current prerequisite links:** missing direct links to currently unfinished
  accepted work created no later than the target, excluding the selected family.
  This is a current safety review, not a reconstruction of the creation queue.
  Tasks added later are listed separately, not retroactively required.
- **Sibling ordering:** missing direct links to earlier reviewer-selected,
  non-archived siblings. Repository policy asks for every earlier sibling, not
  merely transitive reachability through a chain. An observed dependency cycle
  also warns; adding all required edges to a cycle does not make it safe.
- **Historical snapshot comparison:** unverifiable without a retained receipt.
  Today's repaired dependencies cannot prove what was originally stored.
- **Executable observation:** membership in the separate query and a discrepancy
  warning if a waiting target is returned while a stored prerequisite is still
  unfinished. These are non-atomic observations, not scheduler guarantees.

## Optional retained receipt

Add `receipt` to the capture only when a real, complete pre-submission snapshot
and original post-submission readbacks were retained. Never synthesize an old
receipt from today's queue. Receipt schema:

```json
{
  "version": 1,
  "kind": "pre-submission-snapshot",
  "capturedAt": "2026-10-01T10:00:00.000Z",
  "inventory": {
    "truncated": false,
    "totalCount": 1,
    "tasks": [
      {"taskRef": "#90", "state": "PENDING", "createdAt": "2026-10-01T09:00:00.000Z", "dependsOn": []}
    ]
  },
  "readbacks": [
    {"taskRef": "#101", "state": "PROPOSED", "createdAt": "2026-10-01T10:01:00.000Z", "observedAt": "2026-10-01T10:02:00.000Z", "dependsOn": ["#90"]},
    {"taskRef": "#102", "state": "PROPOSED", "createdAt": "2026-10-01T10:01:00.000Z", "observedAt": "2026-10-01T10:02:00.000Z", "dependsOn": ["#90", "#101"]}
  ]
}
```

Values above are synthetic, not live evidence. The comparison uses unfinished
accepted refs from that receipt (not today's queue), plus the selected earlier
siblings. It reports missing **and extra** original links. Missing readbacks
remain unverifiable; invalid/truncated receipts reject the review.

Even a matching receipt proves only agreement with that retained snapshot.
The pre-read/submission/readback interval is not atomic, and readbacks do not
prove dependencies at the exact creation instant. Therefore
`creationTimeCompliance` stays **unverifiable** with these documented callbacks.
The tool never upgrades a current-link result into a creation-time claim.
Receipt contents are reviewer-supplied evidence, not signed platform attestations.

## Evidence handling and verification

Retain only refs, states, dependency lists, timestamps, completeness metadata, and
the reviewer-selected order. Do not retain titles, descriptions, personal
identities, credentials, or raw callback payloads. Keep live captures local under
`.local/follow-up-review/`; do not commit them. Re-read immediately before a manual
acceptance decision, since reports can go stale. Synthetic fixtures are committed
as tests, not as production or scheduling evidence.

Run the bounded synthetic suite:

```sh
node --test scripts/src/review-follow-up-ordering.test.mjs
```

It checks complete/incomplete inventories, main-workspace states, Draft exclusion,
missing receipts, original versus repaired edges, valid direct chains, unsafe
siblings, cycles, later arrivals, executable observations, CLI exit codes, and the read-only callback
capture contract. It does not accept test tasks or exercise platform scheduling.

### Verification record — 2026-10-02

- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run test:task-policy`
  (41 existing policy tests and 15 reviewer fixtures).
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check:task-policy`.
- **PASS:** `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check-operational-skill-evidence`.
- **PASS:** `git diff --check`.
- **PASS, bounded live smoke:** the documented capture recipe read five complete
  state shards (nine unfinished accepted tasks), three exact selected sibling
  records, and a complete empty executable inventory. The CLI returned advisory
  exit 1 for missing current links and sibling edges, with historical compliance
  unverifiable. No receipt was invented. This is task-record evidence from an
  isolated workspace, not application production data or a scheduler test.
  Sanitized capture/report files stay in the ignored local evidence directory.
- **Not verified:** waiting-to-eligible transitions, task assignment, automation
  settings, and atomic creation-time compliance. These are not implied by the
  smoke result.
- **Not applicable:** desktop, phone, tablet portrait/landscape, Chromium/Chrome,
  WebKit/Safari, and physical-device browser checks. No application UI or runtime
  was changed; no application workflow restart was required.

### Broader completion-validation ledger — 2026-10-03

The configured completion run launched application, package, browser, and release
checks concurrently. It exceeded the completion polling budget and did not mark
the task complete. Several commands could not spawn threads/processes
(`Resource temporarily unavailable`, `EAGAIN`), while release-evidence verification
found an incomplete checkpoint. These results are **not passes** and do not
invalidate or replace the focused reviewer checks above.

Every command below used the prefix `bash scripts/src/run-release-node.sh`.

| Command | Observed outcome |
| --- | --- |
| `pnpm --filter @workspace/api-server run test` | Failed wrapper exit; log ends with skipped integration suites, without a specific root-cause diagnostic. |
| `pnpm --filter @workspace/run-calculator run test:budget` | Failed wrapper exit, no detailed cause printed. |
| `pnpm --filter @workspace/production-rules run test` | Passed in the completion run. |
| `pnpm --filter @workspace/inventory-math run test` | Failed wrapper exit, no detailed cause printed. |
| `pnpm --filter @workspace/scheduled-recipe-check run test` | Failed wrapper exit, no detailed cause printed. |
| `pnpm --filter @workspace/spec-export run test` | Passed in the completion run. |
| `python3 scripts/test_gemini_skill_trigger_benchmark.py` | Passed in the completion run. |
| `pnpm --filter @workspace/scripts run check-model-bump` | Failed during runtime/preflight test subprocesses; pending promise at run termination, not a reviewer fixture failure. |
| `pnpm --filter @workspace/scripts run check-operational-skill-evidence` | Passed in the completion run. |
| `pnpm run typecheck` | Could not spawn the package runner's runtime thread (exit 134). |
| `pnpm run audit:prod` | Passed in the completion run. |
| `pnpm --filter @workspace/scripts run check:release-evidence` | Failed: incomplete release checkpoint; retained report left unchanged. |
| `pnpm run release:check` | Could not spawn a Node subprocess (`EAGAIN`). |
| `pnpm run release:check:full` | Could not spawn the package runner's startup thread (exit 134). |
| `bash scripts/src/run-isolated-browser-suite.sh` | Not verified: partial progress only before completion polling expired; no terminal suite result retained. |

No application or release changes were made to conceal these outcomes. A fresh
application/release verification requires serialized checks in a workspace with
available process capacity, and complete revision-matching release evidence.
That broad validation is not a prerequisite for using this advisory offline
reviewer and is not a production-readiness claim.