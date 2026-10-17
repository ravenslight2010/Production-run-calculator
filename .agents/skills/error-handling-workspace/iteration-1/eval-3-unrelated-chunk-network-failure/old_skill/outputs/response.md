Do not use the stale-client update-and-reload path based on these symptoms: the build IDs match, there is no `Notification` reference error, and the 503 followed a brief network interruption while loading an unrelated chunk. This points to a transient fetch failure, not evidence of a stale build.

Keep the form open; do not reload or navigate away while its input is unsaved. Preserve the input first (use an available draft-save option, or copy it somewhere safe). Once the connection is stable, retry the failed chunk/action once. If it still fails, keep the form state intact and seek support rather than forcing a reload.

Sources consulted: `.agents/skills/error-handling-workspace/skill-snapshot/SKILL.md` — Client behavior; Retries and timeouts.
