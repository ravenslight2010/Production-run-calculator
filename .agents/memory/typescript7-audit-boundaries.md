---
name: TypeScript 7 audit boundaries
description: Durable constraints for comparing the native compiler without confusing harness or evidence failures with compiler compatibility.
---

The TypeScript 7 comparison must use one shared declaration extension policy and must build
every referenced composite library before application no-emit checks. Otherwise the comparison
and reproduction can disagree on declaration totals, and both compilers can report a misleading
TS6305 precondition failure.

**Why:** The repository has both `.d.ts` and `.d.mts` outputs, while separate comparison paths
previously counted different subsets and scheduled `recipe-guide-import` differently.

**How to apply:** Treat current-revision evidence as invalid until the two manifests and
prerequisite order agree; keep the TypeScript 6 compiler authoritative while repairing the
comparison harness.