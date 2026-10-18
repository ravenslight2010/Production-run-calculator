Do not use the stale-client “Update and reload” path: this is a 503 while fetching an unrelated lazy chunk, the build IDs match, and the exact `Notification` reference error is absent. That recovery is narrowly scoped to that exact Safari error.

Once the connection is stable, retry loading the failed panel once, without reloading the page. Keep the unsaved form input intact; if the panel still fails, stop retrying and preserve the input (save or copy it if the UI offers no reliable persistence) before considering any reload or further recovery. Treat repeated 503s as an availability issue and report them rather than risking the user's work.

Sources consulted: `.agents/skills/error-handling/SKILL.md` (client failure handling and bounded retries); `.agents/memory/pwa-update-prompts.md` (exact-match stale-client recovery and reload safety).
