---
name: Packaging pause and resume flow
description: Physical downstream drain and refill rules for packaging auto tracking across Press pauses and Freeze-tunnel choices.
---

Pause stops the Press, not the whole line. If the Freeze tunnel keeps running, all in-flight product drains through Packaging. If it is selected to stop, it first accepts all pre-tunnel product, stops full, and Packaging empties.

Resume never creates an immediate packaging catch-up. A tunnel left running uses the complete new-run fill sequence before Packaging restarts. A stopped tunnel remains full, so Resume waits for pre-tunnel refill and Wrapper/Packaging refill but skips tunnel fill.

**Why:** The canvas reflects a physical Press → pre-tunnel → Freeze tunnel → Wrapper/Packaging flow. Treating Pause or Resume as one global switch freezes output too soon or fabricates an immediate burst.

**How to apply:** Derive tracking permission from the shared line-phase model. Rebase zero-based pause and normal clocks at transitions, start from a full case interval, preserve manual/sync guards, and never advance dough counters during downstream-only drain.