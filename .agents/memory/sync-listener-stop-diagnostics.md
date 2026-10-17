---
name: Sync listener stop diagnostics
description: Prevent asynchronous listener work from restoring process-local lag diagnostics after shutdown.
---

Process-local lag diagnostics must be cleared when sync delivery monitoring stops, and any in-flight async drain must be prevented from writing fresh samples afterward.

**Why:** A listener can be stopped while a delivery handler is still pending. Clearing the diagnostic map alone is not durable if that handler later resumes and the drain writes another lag sample.

**How to apply:** When stopping background listeners that publish health diagnostics, guard their later metric/state writes with the listener's stopped state as well as clearing current samples.
