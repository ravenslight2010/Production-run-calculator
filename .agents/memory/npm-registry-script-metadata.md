---
name: npm registry script metadata
description: Keep local npm registry fixtures capable of exercising package lifecycle hooks.
---

Local registry fixtures that test lifecycle scripts must include the package's `scripts` object in the registry version metadata as well as in the tarball's `package.json`. npm may use the registry manifest to decide which dependency lifecycle hooks to run; scripts present only in the tarball can be skipped in an install test.

**Why:** An altered or incomplete fixture manifest can make a lifecycle safety test pass without ever reaching its hook, so the marker assertion would not prove that checksum validation ran before script execution.

**How to apply:** When constructing package metadata for a loopback registry, reuse or mirror the package manifest fields, especially `scripts`. Include a valid-tarball control that confirms the hook writes its marker before asserting that an altered tarball is rejected without a marker.
