Do **not** refresh the tablet now. The Home chunk failed before the screen could establish its normal safety state, and neither a current-day local snapshot nor a complete, authenticated server snapshot has been confirmed. Refreshing, closing the tab, signing out, clearing site data, or reinstalling could interrupt an active run or discard unsaved setup.

Leave the tab open and ask an authorized manager/support person to verify recovery safety first. A pre-Home automatic update recovery is allowed only when a trusted check confirms both:

- An authenticated, complete server snapshot for the tablet's current client day; and
- A matching local snapshot for that same day that shows no active run.

Unknown, malformed, unavailable, or mismatched snapshot state means **unsafe—do not reload**. Even after that proof, retain the existing safety gates: no started-but-unended run, no unpersisted form value, and no blocking dialog or operation; require one uninterrupted minute of update-specific inactivity, then recheck safety before starting worker recovery. Any interaction restarts that idle period. Use only the app's supported recovery flow after every gate is met; do not force a refresh. If support cannot verify the snapshots and safe state, keep the tablet untouched and escalate through the authorized recovery process.

Sources consulted: `.agents/skills/error-handling/SKILL.md` (Client behavior); `.agents/memory/pwa-update-prompts.md` (Pre-Home stale-asset recovery and safe update prompting).
