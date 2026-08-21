---
name: Home navigation history
description: Rules for keeping persisted Home tab selection and browser-back history consistent.
---

Back navigation must consume an existing tab-history entry without recording the reverse transition as a new entry. The initial persisted tab is a starting point, not an implicit back target after reload.

**Why:** Recording reverse transitions caused repeated browser-back presses to revisit tabs instead of unwinding toward the app’s starting tab.

**How to apply:** Keep back transitions routed through the navigation hook’s history-aware operation; do not pop the stack and call the ordinary tab setter directly.