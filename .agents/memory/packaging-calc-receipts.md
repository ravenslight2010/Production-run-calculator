---
name: Packaging calculation receipt invalidation
description: Keeps Run summaries aligned after local or accepted remote packaging corrections.
---

After a local manual packaging correction or an accepted inbound packaging register update, invalidate the selected run's prior operational calculation receipt. Until a fresh projection arrives, the Run summary must fall back to the corrected form values. Keep the projection reference as the monotonic high-water mark.

**Why:** The independent packaging register can be correct while an older, still-eligible calculation receipt continues to supply stale cases to the Run summary. Removing the watermark as part of invalidation would also let a delayed older frame restore that stale calculation.

**How to apply:** When changing packaging sync or calculation adoption, invalidate only the affected run's receipt for manual corrections and accepted register changes. Preserve server acceptance and last-write-wins rules, and never reset the projection high-water mark.