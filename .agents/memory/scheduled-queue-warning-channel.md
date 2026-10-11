---
name: Scheduled queue warning channel
description: Owner-selected surface for stalled or duplicate scheduled-evaluation queue warnings.
---

Scheduled-evaluation backlog and duplicate-bucket warnings belong in non-blocking readiness diagnostics and transition-only structured logs, not generic staff web-push notifications.

**Why:** The owner chose an operator-facing health/log signal to keep backend queue health separate from production timing alerts sent to opted-in staff.

**How to apply:** Use this channel for queue-drain and duplicate-bucket monitoring. Continue using Web Push for its existing production timing alerts.
