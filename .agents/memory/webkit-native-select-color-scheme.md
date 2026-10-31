---
name: WebKit native select color scheme
description: Keep native select controls legible in dark-themed Safari and WebKit views.
---

Dark utility classes do not always change the native palette of a select control in Safari/WebKit. A select may keep a light surface with light foreground text unless its native color scheme is explicitly set.

**Why:** A browser screenshot showed the QC planning range selector white-on-white despite dark theme colors. Class-level foreground/background styling alone was not reliable for the native control.

**How to apply:** For native selects in dark-themed views, set `color-scheme: dark` on the control itself and confirm the result in a WebKit screenshot. Do not infer native-control contrast from text or background utility classes alone.
