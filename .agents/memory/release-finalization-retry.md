---
name: Release finalization retry safety
description: Release checkpoints can contain all passing gates while final evidence promotion has already happened.
---

Release finalization must be retry-safe after any evidence promotion or artifact write. A checkpoint with all gates passed may still need to regenerate or recognize promoted evidence before writing the final report; report-key evidence must also carry the exact current revision.

**Why:** A final report failure after evidence promotion left a successful checkpoint but no pending source-evidence file, so a plain resume could not finish without manual artifact restoration. Workspace restarts can also clear temporary `/tmp` logs while the project-level release checkpoint survives.

**How to apply:** Treat evidence promotion and final report writing as resumable stages, or make promotion idempotent by accepting the already-promoted, revision-validated artifact. After a workspace restart, inspect the durable checkpoint and verify its source revision and mode before using `--resume`; do not infer gate results from missing temporary logs.

For long standalone browser gates, persist a start manifest and private runtime
log in an ignored workspace evidence directory before launching the child.
Exclude that directory from publishing as well as Git. Keep raw traces private.

**Why:** A workspace restart interrupted a full browser run before its end-only
reporter wrote any result; temporary command output disappeared, although some
failure traces survived. A running command and a case listing cannot establish
completion or recover the lost exit status.

**How to apply:** Retain the source/test identity, start time, exact gate and
unchanged budgets up front. After interruption, label the attempt incomplete,
preserve surviving artifacts, and give any fresh run a separate evidence path.
Never invent a final result or use an incomplete attempt as a timing baseline.

Browser progress is diagnostic, not resumable certification. A fresh attempt
must not inherit earlier case passes, including when only verification inputs
changed and the production source is identical.

**Why:** The owner authorized interruption diagnostics independently of the
unresolved release work; preserving a partial run does not authorize rerunning
certification or reconciling the reviewed case inventory.

**How to apply:** Keep tooling verification on fake lifecycle/filesystem events.
Report an existing inventory mismatch honestly to its release owner instead of
changing inventory or budgets to make the persistence task pass.