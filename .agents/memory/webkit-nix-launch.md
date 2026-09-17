---
name: Local WebKit Nix launch
description: Keep downloaded Playwright WebKit usable in Replit's Nix runtime.
---

The downloaded WPE WebKit bundle's shell wrapper resets `LD_LIBRARY_PATH` before
launching its final MiniBrowser executable. A local Nix runner must therefore
append the Nix library roots at the final executable boundary; passing the
variable only to Playwright's browser launch is not sufficient.

**Why:** Replit can resolve libatomic, libstdc++, libGLESv2, and libx264 from
Nix while Playwright's Debian host check still reports them missing. The
browser only launches when the final MiniBrowser process receives those paths.

**How to apply:** Keep CI on Playwright's supported `install --with-deps
webkit` path. For local Nix runs, use the repository WebKit wrapper and retain
the bounded smoke coverage; do not hide a real CI dependency failure with the
local host-check bypass.