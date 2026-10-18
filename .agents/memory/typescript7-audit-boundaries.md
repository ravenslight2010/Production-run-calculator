---
name: TypeScript 7 audit boundaries
description: Durable constraints for comparing the native compiler without confusing harness or evidence failures with compiler compatibility.
---

The TypeScript 7 comparison must use one shared declaration extension policy and must build
every referenced composite library before application no-emit checks. Otherwise the comparison
and reproduction can disagree on declaration totals, and both compilers can report a misleading
TS6305 precondition failure.

Matching aggregate declaration counts from another report do not validate a historical
comparison unless its source revision and output hashes match; equal totals can conceal
different declaration contents or contract classifications.

**Why:** The repository has both `.d.ts` and `.d.mts` outputs, while separate comparison paths
previously counted different subsets and scheduled `recipe-guide-import` differently.

**How to apply:** Treat current-revision evidence as invalid until the two manifests and
prerequisite order agree; keep the TypeScript 6 compiler authoritative while repairing the
comparison harness.

For historical comparisons, additionally bind the retained source identity to the exact
declaration manifests and per-file classification report. A compact count summary or matching
counts in another run is not sufficient evidence to reconstruct missing classifications.

**Why:** Historical source revisions and raw compiler outputs may no longer be available, and
aggregate equality does not prove that approval hashes or contract conclusions belong to the
same run.

**How to apply:** When auditing retained compiler evidence, report missing source/report inputs
explicitly, preserve the original artifact's integrity hash, and avoid promoting a newer
comparison or matching count summary as a substitute.