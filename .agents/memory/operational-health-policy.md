---
name: Operational health display and approval reminders
description: Owner decisions for Packaging tracking-health messaging and approval-expiry reminders.
---

Packaging tracking health should show factual state only, without a new
time-based fault threshold.

**Why:** The owner selected factual status rather than a timed warning.
Unchanged counters can be expected during setup, pauses, demand caps and
manual corrections; delay alone must not assert a tracking failure.

**How to apply:** Distinguish disabled, paused, waiting, pending, accepted and
failed/retryable states using actual evidence. Do not infer physical output or
a fault from elapsed time alone.

Approval-expiry reminders use seven days before the approval expires.

**Why:** The owner explicitly chose seven days for approval expiry, separate
from retained-case deletion/retention notices.

**How to apply:** Remind against the approval's own expiry and scope. Reminder
visibility does not extend authorization, enable capture, or alter retention.
