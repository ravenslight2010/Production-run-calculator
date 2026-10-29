---
name: Shared recipe refresh run identity
description: Async shared-recipe profile fan-out must not update whichever pending run happens to be open when it finishes.
---

Capture the selected run's stable identity before any asynchronous prerequisite, including profile hydration, then require the same run identity before touching the open form. Capturing only inside a later orchestration helper is too late when its caller already awaited setup work. Eligibility alone is insufficient because two pending runs are both eligible.

Background recipe-pool refreshes must also carry their observed generation and recheck it after awaits before writing any pending-run snapshot. A manager save can supersede a queued refresh while its old pool list is still in flight; guarding only profile callbacks leaves stale run-value fan-out possible. Passive cheese/mix pool observations may fill only empty or all-zero linked profile rows; populated rows remain profile-owned, while explicitly acknowledged manager saves/imports remain authoritative.

**Why:** A rapid run switch during an async refresh can leave the second pending run eligible, causing the first run's recipe rows to be written into the wrong form. Separately, an out-of-date background pool observer can finish after a newer acknowledged edit and revert pending-run rows; a passive pool snapshot is not authority to replace a populated saved profile.

**How to apply:** Start the guarded orchestration before hydration or other prerequisite awaits. Compare the originating and current run IDs before invoking the open-form callback; recheck the captured pool generation before post-await profile markers, open-form writes, and pending-run fan-out. Keep background pool refreshes empty-only; preserve full replacement for acknowledged manager operations.