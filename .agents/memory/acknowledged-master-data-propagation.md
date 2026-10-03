---
name: Acknowledged master-data propagation
description: Why a successful local recipe save must explicitly trigger pending-run refresh instead of relying only on cache effects.
---

An acknowledged local master-data save must explicitly trigger its dependent
profile and pending-run refresh. Cache observation remains useful for bootstrap
and peer changes, but it is not a reliable local-save command boundary.

**Why:** Under a slow serial browser workload, the canonical cache publication
can become a component's first observed snapshot. A passive effect then
classifies the real edit as hydration and skips authoritative refresh, even
though the write succeeded.

**How to apply:** Carry the accepted canonical rows from the successful mutation
into an idempotent refresh command. Establish deduplication state synchronously
before awaiting persistence so the later cache effect cannot duplicate or
replace that command.

The currently selected pending run also needs an explicit persisted snapshot
patch after an acknowledged shared recipe or ingredient-weight refresh. Updating
only its open form is insufficient, even if the form already shows the new value.

**Why:** The selected run is excluded from bulk pending-run fan-out to protect
active editing. Form autosave is asynchronous and can be skipped or superseded
while a peer already sees the acknowledged master-data save; the canonical run
then remains stale despite the visible form being correct.

**How to apply:** Patch only the affected fields into the selected run's durable
snapshot when it is still pending and still selected, publish that snapshot,
and never carry the refresh into a started, paused, or ended run.

Delayed recipe-refresh work owns the run selected when the edit began, not
whichever run happens to be selected after profile hydration. Bulk name-linked
fan-out should replace rows only when they still match the previous canonical
recipe; a different row set can be an operator customization.

**Why:** A delayed refresh can otherwise treat a newly selected, unprofiled
run as the edit target, while a pool observer can overwrite its customized
rows before the delayed request even completes.

**How to apply:** Capture selection before asynchronous preparation and check
it again before open-form or selected-snapshot writes. Use the preceding pool
signature to distinguish unchanged links from customized rows; when no prior
signature exists, avoid guessing for unprofiled runs.