---
name: TypeScript source-bundle hashing
description: Cost and verification boundary for the normalized TypeScript comparison source bundle.
---

Bind the normalized TypeScript comparison source-bundle digest to the compact report, and independently recompute it during upload verification when comparison work has already warmed the source inputs.

**Why:** A cold scan took about 100 seconds in this workspace, while a later scan over the same inputs took about four seconds. Cost depends strongly on filesystem/cache warmth, so the cold measurement alone overstates the cost of an immediate verifier pass.

**How to apply:** Generate the report from the canonical comparison inputs and bind its digest plus exact GitHub revision into the run manifest. Before upload, verify the checkout SHA and recompute the canonical bundle hash; measure on the actual CI runner rather than assuming cold-cache cost.
