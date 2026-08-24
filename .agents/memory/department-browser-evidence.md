---
name: Department browser evidence
description: Responsive operational journeys should assert stable semantic state rather than layout-specific text nodes.
---

Operational browser evidence must use role/state assertions that survive responsive markup differences; exact labels may be absent or split on desktop while the same live state is still visible through an actionable control.

**Why:** The department journey rendered run identity differently across desktop and phone, causing text-only assertions to fail even when navigation and the active run were correct.

**How to apply:** Prefer accessible roles, data-testid state, and persisted behavior for cross-viewport checks; reserve text assertions for unique, stable content.

When a tabbed operational surface keeps multiple panels mounted, scope browser locators
to the visible panel before selecting an action. A global role locator can match hidden
copies and make a valid journey appear ambiguous.