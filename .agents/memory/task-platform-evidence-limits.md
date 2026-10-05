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

**Why:** An audit found generated follow-ups missing dependencies that the repository policy expected, while official lifecycle descriptions and the workspace task-state definitions did not fully align.

**How to apply:** Inspect stored dependency metadata for multiple origins and siblings. Record the exact evidence source for state semantics, and mark assignment/mode claims unverified when event history or task settings are unavailable. Do not infer a universal platform guarantee from the repository checker.

Removing dependency edges does not prove that a queued main task has activated.
Explicit chat permission for direct work and eligibility for formal task completion
must be reported separately.

**Why:** A main task remained pending with an empty dependency list after a
user-approved ordering exception; the completion operation rejected it as having
no active task. General task lifecycle documentation did not expose that local
assignment transition.

**How to apply:** Check the live state after a completion rejection. Preserve the
finished work, report the activation requirement, and do not invent a status-update
operation or recreate the task.