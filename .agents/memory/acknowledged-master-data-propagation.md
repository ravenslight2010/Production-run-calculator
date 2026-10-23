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

Do not enable named-recipe editing before the first canonical master-data
bootstrap has resolved. A successful save can arrive while the bootstrap query
has no cached snapshot; updating only an absent cache entry lets the first
bootstrap response hide the acknowledged recipe from the editor.

**Why:** The disabled query state can look like a loaded empty list unless its
pending state is treated as loading. A user could save successfully while the
initial snapshot was still in flight, leaving the new recipe absent from the
visible list.

**How to apply:** Treat `isPending` as loading for named-recipe managers and
disable Add until the canonical pool query resolves. Keep a regression check for
the pre-bootstrap empty state and the acknowledged-save path.

Keep repeated master-data editing disabled through canonical adoption, not just
until the write's HTTP response arrives.

**Why:** The response can arrive while dependent canonical reads still hold the
mutation guard. An enabled Add control then accepts input that the guard silently
ignores, especially on a fast touch interaction.

**How to apply:** Match control availability to the complete mutation-and-refresh
lifecycle. Browser helpers should wait for enabled editing and the acknowledged
canonical row before beginning another command.