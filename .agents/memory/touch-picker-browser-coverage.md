---
name: Touch picker browser coverage
description: Durable testing constraint for responsive selector dialogs in the calculator.
---

Touch-oriented selector behavior is capability-driven, not breakpoint-driven. A browser test that only changes viewport dimensions can still exercise the desktop selector path.

**Why:** The calculator deliberately preserves pointer-device selectors at phone-sized widths, so viewport-only phone tests can give false confidence about the touch dialog experience.

**How to apply:** Configure touch coverage with explicit mobile/touch context capabilities and keep a separate desktop/pointer assertion. Component tests should also stub coarse/fine media queries and maxTouchPoints so hydration and capability routing are deterministic.

Nested touch picker dialogs can otherwise lose focus to the parent dialog when they close; shared picker close handling must suppress the dialog library's default focus target and retry the original trigger after the close frame.

**Why:** Setup Profiles opens recipe pickers inside another dialog, and a one-shot focus call was overwritten by nested-dialog cleanup even though the picker appeared to close correctly.

**How to apply:** Any shared picker used inside a controlled dialog should assert trigger focus after cancel/selection and restore it across the close task/frame boundary.