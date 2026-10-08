---
name: Task-platform evidence limits
description: Distinguish task-policy intent from observed task-platform dependency, lifecycle, and assignment behavior.
---

Task creation paths do not necessarily share dependency controls. The manual task API can accept explicit dependency refs, but the generated follow-up path may link only the parent and allow siblings to run concurrently. Do not treat policy prose, task state labels, or public lifecycle documentation as proof that every generation path enforces a queue snapshot.

Assignment and mode are also separate evidence questions. A read-only task record may expose state without exposing the assignee, execution mode, or transition cause. Public task-board documentation may describe acceptance as starting background work while a workspace-specific task API uses different state names and transitions.

A client-side queue read followed by creation is not an atomic acceptance snapshot. Retrofitting dependencies after submission can race with acceptance and launch. Explicit manual dependency support also does not establish that the generated-follow-up path accepts the same inputs or retains the same hierarchy metadata.

Creation/update timestamps and equal creation times cannot establish acceptance
order or batch acceptance ties. Missing acceptance provenance must remain unknown,
even when stored task dependencies can be inspected.

**Why:** The owner clarified that clicking Accept, not draft creation or task
number, establishes future precedence; exposed task reads do not provide a reliable
acceptance sequence. Inferring one would turn advisory checks into false assurances.

**How to apply:** Require reliable event evidence or explicit owner-attested
acceptance receipts before claiming ordered startup. Keep missing provenance and
missing persisted links as advisory blockers; never claim an agent's decision to
wait has paused platform execution.

## Task sequencing where supported

Use real dependency links when work genuinely depends on prior work. Do not
promise that Drafts or generated follow-ups will enforce one-at-a-time execution;
the owner accepts that the platform may allow concurrent tasks.

**Why:** The owner said the one-at-a-time rule may not be enforceable through
Drafts and follow-ups and is okay with that limitation.

**How to apply:** Preserve dependencies that represent technical or release
ordering, but do not treat concurrent task states as a blocker or infer
acceptance order from task numbers or creation times.

## Task-completion validation scope

Keep automatic completion checks short and broadly applicable. Run focused
domain suites with the task that changes that domain; reserve release evidence,
standard/full release checks, and the full browser suite for release work. Keep
the release GO/NO-GO requirements intact rather than weakening them to unblock
ordinary feature tasks.

**Why:** The owner chose a fast shared completion gate because long release checks
can delay unrelated tasks and fail them on evidence or defects outside their
scope.

**How to apply:** When adjusting project-wide task validation, distinguish the
automatic completion set from workflows that remain manually runnable. Verify
the registered global set and confirm all release commands remain available to
the release owner.

## Background-task configuration snapshots

Replit background tasks run from an isolated project snapshot that includes
configuration and AI context. Changes to the main project's configuration do
not retroactively change a task that was already running.

**Why:** A running task continued to report the previous validation suite after
the main project's automatic validation set was narrowed; Replit's task
documentation confirms that task startup captures project configuration.

**How to apply:** When a validation change appears ineffective, compare the
task's start snapshot with the current main project. Verify the change on a task
started afterward rather than claiming it altered an in-flight task.
