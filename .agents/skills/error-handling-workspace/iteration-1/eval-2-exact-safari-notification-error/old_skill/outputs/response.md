Do not auto-refresh, and do not match every `ReferenceError`. Handle this specific missing-`Notification` startup failure narrowly; a broad handler could hide unrelated bugs, and reloading will not make an unavailable browser API appear.

Show staff: **“Notifications aren’t available in this browser version. You can continue without notifications, or update iPadOS/Safari and reopen the app.”** Offer **Continue without notifications** as the non-destructive recovery action. The report does not establish whether a run is active, so don’t imply that it is safe to discard or reload one; if continuing is blocked, ask staff to confirm/save any work before reopening or contact an authorized manager.

Sources consulted: `.agents/skills/error-handling-workspace/skill-snapshot/SKILL.md` (client recovery actions, safe handling, and avoiding swallowed errors).
