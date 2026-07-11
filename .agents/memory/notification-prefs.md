---
name: Per-user notification preferences
description: Account-backed per-alert push toggles — missing key = ON, merge-not-replace, key lockstep between server allow-list and web kinds, latch-while-suppressed gating
---

Per-alert push-notification toggles are stored on the ACCOUNT (users.notificationPrefs jsonb, surfaced on /me) so choices follow the user across devices — same pattern as `floorModeEnabled`. Combined with Floor Mode in one "Alerts & Floor Mode" header-menu dialog; the old standalone Floor Mode menu toggle is gone.

**Rules:**
- A MISSING key means the alert is ON. Only an explicit `false` suppresses. This makes newly added alert kinds auto-enabled for everyone with zero migration.
- `POST /me/notification-prefs` MERGES the supplied partial map into stored prefs (tx + FOR UPDATE), never replaces — a single-toggle update from one device must not clobber toggles set elsewhere. Unknown keys / non-boolean values are dropped server-side.
- The server allow-list (`NOTIFICATION_PREF_KEYS` in api-server lib/roles) and the web settings panel (`NOTIFICATION_KINDS` in src/notificationPrefs.ts) MUST stay in lockstep — a cross-layer parity test in roles.integration.test.ts imports the web module directly and fails on drift. Add new alert kinds to BOTH plus the test's expectations implicitly cover it.

**Suppression semantics (useNotifications):** each alert effect still advances its latch (run-id ref / Set / cycle key) while suppressed, and reads prefs through a ref (not effect deps).
**Why:** if the latch didn't advance, flipping an alert back ON mid-run would retroactively fire alerts for already-passed milestones; if prefs were in the dep arrays, toggling a switch would re-run milestone effects and re-evaluate old thresholds.
**How to apply:** any NEW alert added to useNotifications must (1) get a kind in both key lists, (2) check `isNotifEnabled(prefsRef.current, kind)` AFTER latching, never before.
