# Sync health sentinel

Managers can run the read-only **Canonical sync self-check** from the Data
Health & Audit workspace. The check is scoped to the live production date and
returns a versioned, bounded report with:

- canonical daily document presence;
- snapshot and server revision identity;
- whether the server can derive the operational projection for the selected
  run; and
- bounded command-receipt and completed-history integrity evidence.

The report is intentionally redacted. It contains statuses, identities, counts,
and next actions, but not day-state payloads, command bodies, recipe values, or
history snapshots. A warning means evidence is unavailable or the scan was
bounded; a failing result means an invariant mismatch was observed. Neither
result performs a repair.

## Operational response

1. Rerun a warning after confirming the production date and that the API is
   reachable.
2. For a failing check, use the named invariant to open the existing data-heal
   or incident review workflow. Do not reset or edit sync data from the
   sentinel.
3. Treat the result as an observation, not as proof that a repair succeeded.
   The server records a safe structured `sync_health_check` event with the
   correlation ID, outcome, check statuses, scope, date, and duration.

Sandbox sessions and staff without the manager capability cannot call the
endpoint. The self-check performs reads only; normal sync, offline conflict,
and convergence behavior are unchanged when the check is unavailable.