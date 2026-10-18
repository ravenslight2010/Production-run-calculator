# Selected pending-run profile snapshot update

## Problem

After a manager saves a brand/flavor profile, shared profile propagation skips
the currently selected run. The open form is then refreshed, but the run's
durable `runValues` snapshot is left to ordinary form autosave. A browser
regression observed the profile POST succeed while the selected pending run
remained stale.

## Approved behavior

After an acknowledged profile save:

1. Keep existing fan-out to other matching, not-yet-started runs and future
   scheduled runs.
2. For the run selected when refresh began, continue only if its ID is still
   selected, its brand/flavor still match, and it remains eligible for shared
   profile refresh in both live and persisted state.
3. Merge the saved profile into the open form using the existing profile
   overlay. Build a targeted patch from fields changed by that overlay; do not
   copy unrelated form state into the run snapshot.
4. Persist and publish that patch through the existing selected-pending-run
   snapshot helper, passing the captured run ID as an identity guard.
5. Never apply the profile refresh to started, paused, or ended runs. Preserve
   per-run values, progress, and the existing manager-controlled profile-save
   behavior.

The snapshot update is only performed after the profile-save acknowledgement.
If the selected run changes before the update starts, the patch is abandoned.
If the canonical sync write fails, the existing queued-sync retry behavior
remains responsible for the locally persisted patch.

## Approaches considered

- **Rely on ordinary form autosave:** no code change, but this is the path that
  failed and leaves persistence dependent on unrelated lifecycle timing.
- **Include the selected run in bulk fan-out:** a single fan-out path, but it
  can race the open form or a Start action with a broad snapshot.
- **Persist a targeted selected-run patch (chosen):** use the existing guarded
  helper after the profile overlay and after identity/eligibility checks. This
  explicitly closes the persistence gap without changing other fan-out paths.

## Scope

This change is limited to the web client's selected pending-run profile-save
path and its regression coverage. It does not change the per-pizza advisory,
profile API, database schema, profile ownership, stored historical data, or
native mobile behavior.

## Verification

The existing responsive browser test for remembered non-default pepperoni
batch weights will verify that:

- the selected pending run's canonical server snapshot receives the saved
  weight;
- a peer sees that weight after reload;
- the started run retains its original values, including its default pepperoni
  sticks and batch weight.

Run the focused regression and applicable client typecheck/tests. Browser
evidence is development fixture evidence, not production or physical-device
evidence. Physical Android/iOS/PWA checks are not applicable to the web-only
client; WebKit coverage must be reported separately from Chromium evidence.
