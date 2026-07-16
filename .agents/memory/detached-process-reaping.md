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
