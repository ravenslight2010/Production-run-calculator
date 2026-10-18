Do **not** auto-refresh, and do **not** match all `ReferenceError`s. Offer recovery only for the exact Safari message `Can't find variable: Notification`; a broad match or automatic reload could interrupt active work.

Staff should see:

> **Update needed**  
> This device may be using an older cached version. We couldn’t confirm whether a run is active, and reloading may interrupt work or discard unsaved changes. Pause or finish and save your work first. When it’s safe, choose **Update and reload**. If you’re unsure, ask your supervisor.

Keep the action opt-in. After staff choose it, check for and activate a waiting update if available, then reload; otherwise perform a normal reload. For incident diagnosis, retain the exact error and include a non-empty, deployment-specific web build ID.

**Sources consulted:** `.agents/skills/error-handling/SKILL.md`; `.agents/memory/pwa-update-prompts.md`.
