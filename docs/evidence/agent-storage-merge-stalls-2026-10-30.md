# Agent Storage and Merge-Wait Investigation

**Incident date:** 2026-10-30; the reported `-122` event's exact time and
timezone were not available in the task record.
**Incident source revision:** `8e2abf206a5416517d43e87590784de21601f092`
**Local inspection:** 2026-10-30 20:32 UTC, checkout revision
`6c0b9f597ca407beedd779054e9ad5ca3715adbd`
**Environment:** main development workspace. The write probe used a temporary
directory under the workspace; it contained no application or customer data.

## Conclusion

The available evidence does not identify why workspace/tool writes returned
`Unknown system error -122`, and it does not establish a relationship between
those errors and Replit-managed task merge waits.

The host filesystem had substantial free space at both the reported incident
snapshot (about 183 GB, according to the task record) and this inspection
(184 GB). This does **not** rule out a workspace-specific or managed-state
quota. Btrfs quota-group inspection was denied, the `quota` utility is absent,
and this session has no access to the Workspace Settings usage dashboard.

A bounded local write test passed: it created a file and atomically replaced
it by renaming a same-directory temporary file. That verifies this checkout's
ordinary filesystem path at inspection time only. It does not exercise the
Agent's durable writer, managed storage, or the historical failing operation.
No repository-controlled fault was reproduced, so no application/setup code
was changed.

Read-only task records now show tasks #3732, #3735, and #3730 as merged. Their
records do not expose run transitions, queue-wait reasons, or merge-lock
ownership. The report that they waited and later merged after a retry remains
owner-reported; current merged states do not establish when or why a wait
ended.

## Bounded timeline and evidence

| Time | Observation | Evidence class and limit |
|---|---|---|
| 2026-10-30, exact time and timezone missing | Task-plan writes, atomic file updates, and durable tool execution reportedly returned `Unknown system error -122`. | **SUPPORTED REPORT; cause unresolved.** The task record contains sanitized error wording, not a platform run log or quota counter. |
| 2026-10-30, exact time missing | A separate draft reportedly warned that workspace storage was full. | **OWNER-REPORTED.** No associated usage-dashboard measurement or run identifier was exposed. |
| Incident snapshot, 2026-10-30 | The task record reports about 183 GB free on the host filesystem. It also reports a live workspace estimate falling from about 8.4 GB to 6.7 GB after removing roughly 739 MB of registry metadata and a 980 MB obsolete pnpm v10 cache; writes still failed. | **TASK-RECORD HISTORY, not independently remeasured for that time.** This distinguishes host free space from a possible workspace quota. The cleanup and later merge outcome are not causally linked by this evidence. |
| 2026-10-30, reported window not bounded | The owner reported Agents stalled while tasks #3732, #3735, and #3730 waited for merge locks, then reported that the tasks merged after a retry request. | **OWNER-REPORTED.** No exact run start/end times, local timezone, lock events, or causal sequence were available. |
| 2026-10-30, task-record inspection | The authorized task query returned all three listed tasks as `MERGED`. Their record `updatedAt` fields were #3732 `20:16:28.267Z`, #3735 `20:19:17.556Z`, and #3730 `20:22:06.117Z`. | **CURRENT TASK METADATA ONLY.** These are record-update values, not run-transition or merge-lock timestamps; they are not used to order run events. |
| 2026-10-30 20:32 UTC | `df -h` showed a 256 GB filesystem, 72 GB used, and 184 GB available. The workspace tree measured about 6.7 GB. The workspace is mounted as a Btrfs subvolume. | **DIRECT LOCAL MEASUREMENT.** Does not show any workspace-specific or remote managed-state quota. |
| 2026-10-30 20:32 UTC | `btrfs qgroup show` returned `Operation not permitted`; no `quota` utility was available. | **BLOCKED.** Quota-group details are not inspectable from this session. |
| 2026-10-30 20:32 UTC | A temporary workspace file was created, read back, atomically replaced by same-directory rename, and read back again; the owned probe directory was removed. | **PASS, local filesystem only.** No durable Agent/tool operation was invoked, so this does not resolve the historical `-122`. |
| 2026-10-30 20:32 UTC | The local validation lock-history reader found no local wait history. No workspace-local Git lock or in-progress Git operation was found. | **PASS, local scope only.** These checks do not inspect Replit-managed task/merge locks. |

## Findings and causal classification

| Finding | Classification | Basis |
|---|---|---|
| Host-volume exhaustion caused the incident | **Not supported by available measurements** | The incident record reports about 183 GB free; the current sample showed 184 GB free. Neither measurement rules out a separate quota. |
| A workspace-specific or managed-state quota was exceeded | **Unresolved / unavailable evidence** | No quota limit or usage counter was exposed. Btrfs qgroup inspection was denied, and this session could not open the workspace usage dashboard. |
| The `-122` error came from a repository-controlled file-write defect | **Not reproduced; unresolved** | Ordinary create and atomic replacement work in the current checkout. The exact failing durable writer and historical invocation are not available to this shell. |
| The local validation runner caused the named task waits | **No evidence** | Local wait history is empty. That history records only this checkout's validation lock, not platform task locks. |
| The named merge waits mean the Agents were dead or idle | **Not established** | A task state and later merged state do not show worker activity, wait reason, or cancellation. No run event history was exposed. |
| Storage errors and merge waits share a cause | **Unresolved hypothesis, not demonstrated** | The incident times are not bounded closely enough and neither the quota counters nor run/lock events are available. |
| Repository repair is indicated | **No confirmed repair** | No safe repository-controlled cause was demonstrated. No task, lock, Agent state, user data, Git history, or workflow was changed. |

## Authorized sources and access limits

- The task system provided read-only records for #3732, #3735, #3730, #3745,
  and the merged baseline #3665. It did not provide task-run logs or
  merge-lock event data.
- Official Replit documentation says storage usage and total limits are
  available in **Workspace Settings → Usage**, with resource filtering by
  project/type. The editor's project resource panel can also show storage
  consumers.
- Official task documentation says an individual task thread/Agent chat can
  expose work logs, test results, and Agent history. Those run details were
  not returned by the task-record tools available here.
- The public task metadata's `updatedAt` is not treated as a run transition
  timestamp. No public status check can attribute an account-specific run.

## Safe next diagnostic and platform handoff

1. In **Workspace Settings → Usage**, inspect the storage limit and current
   usage for this workspace and project. Capture the relevant figures and
   timestamp only; do not delete more files or Agent state to test a quota.
2. In the individual Replit task threads for #3732, #3735, and #3730, inspect
   the work logs and Agent history for the 2026-10-30 reported window. Use the
   same local timezone for any times supplied by the owner and convert them
   to UTC for correlation.
3. If those records do not explain the waits, ask Replit's authorized platform
   investigation to correlate those task references with task-run queued,
   started, last-progress, and ended events; queue/wait reason; merge/apply
   lock owner and acquire/release events; cancellation/timeout classification;
   and any Agent error category. Also ask it to compare the relevant
   workspace/project quota counters with the sanitized `-122` window.
4. Keep the handoff to task references, approximate time window, source
   revision, sanitized error code, and local measurements. Do not send full
   conversations, customer data, credentials, raw environment output, or
   unrelated process arguments.

There is no evidence-based reason to remove locks or retry file cleanup. If
the error recurs, preserve its exact timestamp/timezone, affected write
surface, sanitized error, and the corresponding Usage reading before making
any cleanup change.

## Verification

- **PASS** — read-only task query confirmed the current merged states of
  #3732, #3735, and #3730; no lifecycle or lock mutation was made.
- **PASS** — workspace file creation and same-directory atomic replacement
  probe; the unique temporary directory was removed after the check.
- **PASS** — local Git status/lock inspection and local validation lock-history
  read; no local lock was changed.
- **BLOCKED** — workspace-specific quota and Replit-managed storage usage:
  qgroup inspection returned `Operation not permitted`; Usage dashboard was
  not available to this session. **Owner:** workspace owner/admin. **Next
  action:** inspect Workspace Settings → Usage.
- **BLOCKED** — historical task-run and Replit merge-lock events for
  #3732/#3735/#3730. **Owner:** Replit platform diagnostics, with the owner
  locating the task threads and exact local-time window. **Next action:**
  inspect thread history, then request the specific event correlation above
  if still missing.
- **NOT REACHED** — repository code repair and regression suite; no
  repository-controlled failure was demonstrated.
- **NOT APPLICABLE** — application UI/browser/device tests; this investigation
  changed no product behavior.

### Sources

- Incident facts and source revision: `.local/tasks/task-3745.md`.
- Prior investigation baseline: `docs/evidence/agent-stalls-investigation-2026-10-23.md`.
- Replit storage guidance:
  <https://docs.replit.com/teams/observability> and
  <https://docs.replit.com/help/projects-and-files>.
- Replit task guidance:
  <https://docs.replit.com/features/agent/task-board>,
  <https://docs.replit.com/core-concepts/agent/task-system>, and
  <https://docs.replit.com/features/agent/task-lifecycle>.
