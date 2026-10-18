Show staff a recovery message only when the error is exactly `Can't find variable: Notification`:

> This app couldn’t start on this device. Reloading may interrupt work in progress. Continue only after confirming your run and changes are safe.

Offer an **Update and reload** action. Do not refresh automatically: the report does not establish that no run is active. Keep matching narrowly scoped to this exact Safari error; do not offer this recovery for every `ReferenceError`. After staff choose the action, check for and activate a waiting service worker if available, then reload; if there is no waiting worker, perform an ordinary reload.

Sources consulted: `.agents/skills/error-handling/SKILL.md`; `.agents/memory/pwa-update-prompts.md`.
