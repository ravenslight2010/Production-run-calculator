---
name: Touch picker browser coverage
description: Durable testing constraint for responsive selector dialogs in the calculator.
---

Touch-oriented selector behavior is capability-driven, not breakpoint-driven. A browser test that only changes viewport dimensions can still exercise the desktop selector path.

**Why:** The calculator deliberately preserves pointer-device selectors at phone-sized widths, so viewport-only phone tests can give false confidence about the touch dialog experience.

**How to apply:** Configure touch coverage with explicit mobile/touch context capabilities and keep a separate desktop/pointer assertion. Component tests should also stub coarse/fine media queries and maxTouchPoints so hydration and capability routing are deterministic.