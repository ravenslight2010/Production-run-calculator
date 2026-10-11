---
name: Detached background processes get reaped
description: Long-running detached bash processes (setsid/nohup/disown) die when the agent shell session ends — long real-AI harness runs can't be backgrounded.
---

# Detached background processes get reaped

`setsid`/`nohup`/`disown` from the agent bash tool does NOT keep a long-running
process alive: it dies shortly after the tool session ends (observed: the
verify-large-spec-import harness died mid first AI call every time, silently —
output file just stops growing; `pgrep -f <pattern>` false-positives on the
polling bash wrapper itself, masking the death).

**Why:** the environment reaps orphaned process groups from tool sessions; a
multi-minute real-AI harness (~100s+ per chunk call) can't finish inside the
2-minute bash tool limit either.

**How to apply:** for runs longer than ~2 minutes, don't background them from
bash. Either run them through a configured workflow, shrink the run to fit in
one foreground call, or judge whether the run is actually required (the
scale harness is mandatory for MODEL changes; for prompt-rule changes the
e2e-spec-roundtrip rule harness is the relevant check). When polling with
pgrep, exclude your own wrapper (`pgrep -f pattern | grep -v $$`-style) or
check output-file growth instead.

A managed workflow can report `failed` while a child API process from that
workflow still owns its port. Starting another copy then fails with
`EADDRINUSE`, even though the workflow status suggests nothing is running.

**Why:** Workflow state and child-process lifetime can diverge after a failed
restart; the existing process may still be healthy and serving the old build.

**How to apply:** Before retrying a port-conflict restart, inspect the workflow
logs, listener/process owner, and endpoint response. If the listener belongs to
the same managed workflow, use the workflow restart to replace it; do not start
a second server or kill an unverified process.
