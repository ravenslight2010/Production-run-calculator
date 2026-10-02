---
name: Task-platform evidence limits
description: Distinguish task-policy intent from observed task-platform dependency, lifecycle, and assignment behavior.
---

Task creation paths do not necessarily share dependency controls. The manual task API can accept explicit dependency refs, but the generated follow-up path may link only the parent and allow siblings to run concurrently. Do not treat policy prose, task state labels, or public lifecycle documentation as proof that every generation path enforces a queue snapshot.

Assignment and mode are also separate evidence questions. A read-only task record may expose state without exposing the assignee, execution mode, or transition cause. Public task-board documentation may describe acceptance as starting background work while a workspace-specific task API uses different state names and transitions.

**Why:** An audit found generated follow-ups missing dependencies that the repository policy expected, while official lifecycle descriptions and the workspace task-state definitions did not fully align.

**How to apply:** Inspect stored dependency metadata for multiple origins and siblings. Record the exact evidence source for state semantics, and mark assignment/mode claims unverified when event history or task settings are unavailable. Do not infer a universal platform guarantee from the repository checker.