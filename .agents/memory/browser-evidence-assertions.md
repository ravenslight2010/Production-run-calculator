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

For setup recipe picker coverage, wait for the canonical master-data bootstrap
before opening the editor. Treat the dough, sauce, and mix controls as custom
dropdowns, but use `selectOption` and option-level assertions for the cheese
control, which is a native select. Scope controls by their visible recipe-card
label rather than depending on picker order.

**Why:** The editor mixes custom and native picker implementations, and async
bootstrap/consolidation can change both option readiness and the number/order of
visible recipe controls.

**How to apply:** In manager setup browser fixtures, await the mocked bootstrap
response, assert malformed option values are absent from the open control, and
select the valid value through the control's actual interaction model.