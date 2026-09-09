---
name: Browser evidence assertions
description: Browser verification should assert visible user-facing containers and labels, not internal IDs or exact text nodes with nested controls.
---

Use visible labels and container-level text assertions for browser evidence. Internal
record IDs are implementation details and exact text matching breaks when a status
line contains a nested action such as Undo; fixture records should use distinct
user-facing labels when order or identity matters.

**Why:** Operational browser checks previously passed their behavior but failed on
selectors that did not match the rendered UI contract.

**How to apply:** Prefer `toContainText` on the rendered result or a stable
`data-testid`; use exact text only when the target element's full text is known to
contain no nested controls.