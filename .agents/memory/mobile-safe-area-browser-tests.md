---
name: Mobile safe-area browser tests
description: Browser-emulation caveat for safe-area geometry assertions in the web app's optional mobile test path.
---

Headless mobile Chromium may serialize unsupported `env(safe-area-inset-*)` CSS
values as an empty computed string instead of `0px`. Safe-area geometry tests
must normalize a missing or non-numeric computed value to a zero inset.

**Why:** Passing an empty string to `parseFloat` produces `NaN`, turning an
otherwise-valid geometry assertion into a false failure.

**How to apply:** Keep device-browser checks strict about layout padding and
viewport containment, but use zero as the fallback inset when collecting CSS
environment values from emulated browsers. A browser that exposes a real inset
will still be checked against that value.