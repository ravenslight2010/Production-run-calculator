---
name: PWA update prompts
description: Safe update prompting and stale-client recovery worker lifecycle.
---

Keep Vite PWA's `registerType: "prompt"` and never let update detection itself reload. Workbox workers may `skipWaiting`, but must never `clientsClaim`. Automatic reload is allowed only through the calculator's explicit safe-state contract after one uninterrupted minute of update-specific inactivity.

**Why:** A fully cached legacy error boundary cannot run newer React recovery code. A worker that activates without claiming lets that legacy screen's existing, user-chosen generic reload enter the fixed bundle. It must not reload or replace the open page because that page can hold a live run, form, or import.

**How to apply:** Keep the persistent reload toast even when the worker activates immediately: observe an installed update as well as `needRefresh`. Background checks may discover/install/activate but never navigate. The safety contract must be replayable because Home can publish from a descendant effect before the app-level update coordinator subscribes. Home-owned surfaces belong in one named blocker inventory; locally owned dialogs and operational prompts register unique blockers that aggregate with Home rather than publishing competing safe/unsafe values. Treat an unsolicited service-worker `controlling` event as no reload permission; only an explicit manual or safe-idle intent may navigate, and re-check that intent at the controlling event. Auto-handoff requires no started-unended run, no unpersisted form value, no blocking dialog/operation, and a dedicated one-minute idle window; interaction resets only that window. Validate unsafe preservation and safe auto-handoff in a real browser.

**Stale-client recovery:** Only the exact Safari `Can't find variable: Notification` reference error gets an "Update and reload" action. It may check and activate a waiting worker after the staff member clicks, otherwise it uses an ordinary reload.

**Why:** A cached iOS bundle can still evaluate the legacy free `Notification` global even though current code safely probes `window.Notification`. Broad error matching or automatic recovery could interrupt unrelated active production work.

**How to apply:** Keep this recovery opt-in and exact-message scoped. Embed a non-empty, deployment-specific web build ID in every web incident so stale-client reports can be distinguished from a current-code regression.

**Pre-Home stale-asset recovery:** When a lazy Home chunk fails before Home can publish its normal blockers, automatic recovery may use a trusted pre-Home safety check. Require an authenticated complete snapshot for the current client day and a matching current-day local snapshot to show no active run; unknown, malformed, or unavailable state stays unsafe. Recheck after the safe-idle interval before beginning worker recovery. This supplements the existing gate and does not shorten or relax its inactivity policy.

**Why:** The old shell can encounter its stale Home failure before the Home effect reports any safety state. Treating that missing report as safe would be unsafe; treating it as permanently unsafe prevents the intended recovery. A narrowly scoped proof from both persisted and authoritative current-day state resolves that gap without making recovery available during active work.

**How to apply:** Keep the pre-Home proof limited to state that can exist before Home mounts, fail closed on uncertainty, and retain the existing Home blockers and idle timing as the normal policy.

**Installed-app update recovery:** The user reported that many refreshes failed to update the PWA and clearing site data finally worked. They approved repairing the complete data-safe update path, not just adding a manual update button.

**Why:** Ordinary refresh is not sufficient evidence that an installed app has entered the new build. Clearing site data can destroy unsynced operational work.

**How to apply:** Verify a genuine old-to-new build handoff and persistence survival. Do not recommend blanket site-data clearing as the standard remedy or infer the precise cache/lifecycle defect from this report alone.

**Update evidence boundary:** A successful fresh release-identity check is required
before saying the app is current. Installation, activation, and a reload request
are intermediate stages; update completion requires the next document to report
the exact intended build. Keep the confirmation attempt tab-local and bounded.

**Why:** Worker lifecycle promises and controlling events do not prove that a new
page started. Reporting success early conceals stranded handoffs.

**How to apply:** Preserve the last running/target identities and a bounded,
payload-free stage history on failure. Keep recovery retryable without clearing
precache, business stores, settings, sessions, or offline queues. Recheck recovery
safety after asynchronous activation, not just before starting discovery.

**Fixture safety:** Isolate manual recovery with continued input activity, not a
fake active authoritative run. Active-to-idle scenarios must provide complete
canonical snapshots so the real Stop action can pass its foreground fence.

**Why:** An old manual-reload fixture can accidentally encode permission to
bypass active-work protection, or mistake an unresolved sync fence for a PWA
handoff failure.

**How to apply:** Keep explicit active-work refusal and once-only confirmed
navigation assertions. Prefer those observable outcomes to counts of internal
registration calls when an already-installed worker needs no new discovery.
