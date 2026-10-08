---
name: Detached process lock inheritance
description: Keep daemonized local services from retaining a startup helper's advisory lock.
---

A background child started while the shell holds a `flock` must close the lock descriptor before detaching. Otherwise it inherits the open file description and retains the lock after the helper exits, so later status, stop, or start commands block for the daemon's lifetime.

**Why:** The local model endpoint's first lifecycle test showed that a detached server inherited its helper's lock and made every subsequent management command wait indefinitely.

**How to apply:** When a locked shell launches a long-lived process, close the lock FD in the child command's redirections and test a full start → status → stop → start sequence.
