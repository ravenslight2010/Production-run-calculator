---
name: Task-platform evidence limits
description: Distinguish task-policy intent from observed task-platform dependency, lifecycle, and assignment behavior.
---

Task creation paths do not necessarily share dependency controls. The manual task API can accept explicit dependency refs, but the generated follow-up path may link only the parent and allow siblings to run concurrently. Do not treat policy prose, task state labels, or public lifecycle documentation as proof that every generation path enforces a queue snapshot.

Assignment and mode are also separate evidence questions. A read-only task record may expose state without exposing the assignee, execution mode, or transition cause. Public task-board documentation may describe acceptance as starting background work while a workspace-specific task API uses different state names and transitions.

A client-side queue read followed by creation is not an atomic acceptance snapshot. Retrofitting dependencies after submission can race with acceptance and launch. Explicit manual dependency support also does not establish that the generated-follow-up path accepts the same inputs or retains the same hierarchy metadata.

## Genuine dependencies, not global sequencing

The owner discarded the one-task-at-a-time rule. Use dependency links only for
genuine technical or user-outcome prerequisites. Unrelated work does not block a
task, and task numbers, acceptance time, or creation time do not establish priority.

**Why:** The owner explicitly removed the rule after it failed to govern Drafts
and follow-ups and added unnecessary coordination.

**How to apply:** Preserve real prerequisites and prevent conflicting edits on
shared surfaces, but never demand acceptance-order receipts or wait for unrelated
tasks. Agent prose cannot pause the platform scheduler.

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

## Self-sufficient task descriptions

Every Draft, accepted task, and follow-up description must carry all applicable
task rules, including evidence-first ownership and task-specific safeguards.
Fix discovered errors in the owning task when safe and authorized, even outside
the original scope; never silently ignore them. If not safely fixable, retain the
evidence, exact blocker/risk, accountable owner, and next action. Ask only for
decisions or permissions the user controls, not retrievable evidence.

**Why:** The owner reported that new tasks still shifted work back to them and
explicitly requested all applicable rules plus repairs outside the original
scope. Shared policy prose alone had not made descriptions self-contained.

**How to apply:** Put the contract and applicable safeguards directly in each
description, including follow-ups. Keep project-specific authoring guidance in
editable project-owned files, not platform-managed skills. A policy test guards
instructions but cannot guarantee isolated task-runner compliance.
