---
name: Cases-on-line occupancy
description: Physical line occupancy includes the upstream two-wide press-to-oven segment, while freezer WIP remains the completion/auto-track basis.
---

The physical cases-on-line estimate may include parallel upstream capacity without changing adjusted throughput, configured timing, or freezer-specific press completion.

**Why:** The production line carries product in both the existing single-file window and the measured two-wide segment; collapsing them into one timing window undercounts steady-state occupancy.

**How to apply:** Keep occupancy lifecycle math (ramp, pause, end drain) separate from freezer WIP and all output/timing counters. Use the adjusted ppm as the sole rate input.