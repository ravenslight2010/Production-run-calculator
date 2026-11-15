---
name: sync-diagnostics
description: Use when diagnosing sync issues, outbox, pool pressure, wake failures, timestamp problems, offline/online alignment, or tablet refresh behavior in the production assistant.
---

# Sync Diagnostics Skill

## Purpose
Help investigate and fix synchronization, outbox, pool-pressure, wake, and timestamp issues — especially when moving away from the heavy v1 sync engine toward V2’s server-authoritative model.

## When to use
- Tablets not staying in sync
- Outbox backlog or failed commands
- Pool pressure / wake failures
- Timestamp or revision conflicts
- Offline vs online behavior questions

## Core rules
1. Prefer server-authoritative commands + refresh over the old v1 auto-track / pool design.
2. Always look at revision / idempotency / outbox transaction boundaries first.
3. Distinguish “client thinks it’s offline” from “server rejected the command”.
4. Never recommend reintroducing the v1 sync stack unless explicitly requested.

## Workflow
1. Identify symptoms (which devices, which runs, last successful sync).
2. Locate outbox, revision, and refresh code paths.
3. Check for timestamp / clock skew or long-running transactions.
4. Propose the smallest fix that keeps the V2 model intact.
5. Suggest logging or diagnostic queries that can be run locally.

## Output
- Root-cause hypothesis ranked by likelihood
- Specific files / functions to inspect
- Suggested diagnostic queries or logs
- Recommended fix that avoids reintroducing v1 sync patterns
