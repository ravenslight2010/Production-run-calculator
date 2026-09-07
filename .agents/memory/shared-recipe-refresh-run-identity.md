---
name: Shared recipe refresh run identity
description: Async shared-recipe profile fan-out must not update whichever pending run happens to be open when it finishes.
---

Capture the selected run's stable identity before any asynchronous prerequisite, including profile hydration, then require the same run identity before touching the open form. Capturing only inside a later orchestration helper is too late when its caller already awaited setup work. Eligibility alone is insufficient because two pending runs are both eligible.

**Why:** A rapid run switch during an async refresh can leave the second pending run eligible, causing the first run's recipe rows to be written into the wrong form.

**How to apply:** Start the guarded orchestration before hydration or other prerequisite awaits. Compare the originating and current run IDs before invoking the open-form callback; profile fan-out itself may still complete.