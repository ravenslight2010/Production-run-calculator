Do not auto-refresh: the report does not establish whether a run is active. Do not treat every `ReferenceError` as this same issue. Recognize the specific startup failure, `Can't find variable: Notification`, and offer staff an explicit recovery action.

**Show staff:** “This app version couldn’t start in Safari. Before refreshing, confirm that no run is in progress or that its values are saved. When it’s safe, select **Reload app** to load the current version. If it still won’t start, contact support.”

Keep local/offline data intact during recovery; handle other `ReferenceError`s as distinct failures rather than silently applying this reload path to them.

**Sources consulted:** `.agents/skills/error-handling-workspace/skill-snapshot/SKILL.md` (Client behavior; Retries and timeouts).
