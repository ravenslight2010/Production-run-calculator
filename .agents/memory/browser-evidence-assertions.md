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

When an accessible name includes a live count, match its stable label prefix
rather than the complete count-dependent name.

**Why:** `aria-label` overrides visible menu text, so an exact-name locator can
stop matching as soon as fixture data populates a count.

**How to apply:** For counted actions, use a role locator with a prefix regex and
assert the visible count separately.

For responsive browser journeys that navigate through a menu before using a
native `<details>` disclosure, wait for the destination surface to become
visible and assert that the disclosure is open before checking its contents.

**Why:** A tablet WebKit report journey intermittently reached the disclosure
before the Summary surface had settled; checking the destination and open state
stabilized the user interaction without changing the UI or adding retries.

**How to apply:** After menu navigation, wait on a visible heading or stable
surface selector, activate the disclosure normally, then assert its `open`
state before interacting with nested controls. Avoid fixed sleeps or forcing
the disclosure open through script evaluation.

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

Custom recipe-picker triggers retain their fixed accessible label after a
selection; the selected recipe is rendered as trigger content. Assert the
stable picker locator plus `toContainText` for the selected value rather than
looking for a new button whose accessible name is the recipe.

**Why:** The accessible name is intentionally the control label ("Dough
recipe", "Sauce recipe", etc.), so a role/name assertion against the selected
recipe fails even when the picker works correctly.

**How to apply:** Keep selector-drift checks anchored to the picker test ID
and accessible label, then verify the chosen recipe through container text.

Touch pickers live in dialogs; scope search fields and options to the active
picker dialog instead of querying the page globally. A prior closed picker can
leave a hidden matching search field in the DOM.

**Why:** Global placeholder queries can become ambiguous when consecutive
pickers are opened inside the same setup dialog, even though only one is active.

**How to apply:** Resolve the picker dialog by its accessible title, assert it
is visible, then query its search field and options within that dialog.