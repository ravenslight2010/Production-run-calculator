---
name: PR dependency snapshot isolation
description: Security boundary for comparing dependency advisories against a pull-request base revision.
---

Compare an untrusted base revision by extracting only its lockfile and auditing that lockfile in a fresh temporary project. Do not check out or execute base-revision manifests, lifecycle hooks, or scripts, and do not pass registry credentials to the comparison.

**Why:** Pull-request-controlled dependency metadata can cause code execution if the comparison installs packages or runs base scripts. The comparison needs dependency graph data, not executable project content.

**How to apply:** Use a trusted package-manager binary, a minimal generated project, a clean home/config directory, and a public registry without auth. Keep malformed snapshots and registry failures clearly unavailable and informational.
