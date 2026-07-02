---
name: Dropdown scroll snap-to-top (dev preview)
description: Web dropdown lists snapping to top while scrolling — only in Replit dev preview; scroll-keeper hook is the defense.
---

# Dropdown scroll snap-to-top

**Symptom (user report, July 2026):** scrollable dropdown lists (brand/flavor pickers,
TypeDropdown menus incl. Setup applicator/pep lists) snap back to the top while the user
wheel-scrolls; the panel stays OPEN. Desktop mouse, Edge/Chrome, and — key detail —
**only in the Replit dev preview while the agent is working**, not the published app.

**What was ruled out empirically** (Playwright e2e, 49-item list):
- plain wheel scrolling, slow and fast — stable
- 35s+ idle hold across the 30s autosave push — stable
- peer live-sync edits from a second tab (brand add, numeric change, flavor add) — stable
- a RUNNING run (useClock re-renders home.tsx every 1s) — stable

**Conclusion:** app re-renders do NOT rebuild the list DOM (React reconciliation keeps
nodes). The remaining consistent cause is dev-mode hot updates (file saves during agent
sessions): Fast Refresh can rebuild the DOM subtree while component state (open=true)
survives → list rebuilt at scrollTop 0 with the panel still open. Full-reload suppression
in vite.config.ts only stops `location.reload()`, not hot updates.

**Defense in place:** `useDropdownScrollKeeper(open)` in web `home.tsx` — saves scrollTop
on every scroll, restores it via a ref callback whenever the list node is (re)created
while open, resets to 0 on a fresh open. Wired into TypeDropdown, IngredientSelect, and
the brand/flavor combobox panels. If new scrollable dropdown panels are added to web, wire
them into the keeper too. Caution if reused: the hook mutates a ref during render
(open-transition check) — fine today, but avoid copying that pattern into concurrent-
sensitive code.

**How to verify future reports:** plant `el.dataset.probe` on the list; after a "jump",
probe gone = DOM node replaced (remount), probe present = something set scrollTop.

**Testing gotchas learned:** the testing subagent's notebook dies on long evaluate
sampling loops — instead install an in-page `setInterval` recorder with ONE evaluate and
read the array back with ONE final evaluate. Background `nohup` loops started from the
bash tool do NOT reliably survive, and /tmp is not shared across bash sessions; to touch
files on a timer during a test, run the timer inside the code_execution notebook
(`timers/promises` + Promise alongside the awaited runTest).
