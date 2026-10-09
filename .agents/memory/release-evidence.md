---
name: Release evidence boundaries
description: Preserve source, revision, runner, and artifact identity when reviewing release and operational proof.
---

# Release and operational evidence

Treat release and operational evidence as scoped records, not interchangeable summaries. Bind it to its source database or report, environment, exact revision, runner, and provenance. Preserve full task-run reports for handoffs, keep screenshots masked and isolated, and keep synthetic recovery evidence separate from authoritative release gates.

**Why:** A plausible screenshot, stale revision, synthetic fixture, or shortened CI summary can appear convincing while proving a different system state than the one being evaluated.

**How to apply:** Before relying on release, browser, container, source-audit, or CI evidence, confirm its source and revision identity and retain the original artifact needed to reproduce the claim.

## Detailed references

- [Visual baselines](visual-regression-baselines.md) and [browser evidence](release-browser-evidence.md)
- [Release gate budgets](release-check-shard-budget.md), [browser case contracts](browser-release-case-contract.md), and [container proof](container-image-release-evidence.md)
- [Source reconciliation boundary](source-reconciliation-evidence-boundary.md), [large audit captures](large-source-audit-captures.md), and [source audit CLI paths](source-audit-cli-paths.md)
- [WebKit operational report fixture](webkit-operational-report-fixture.md)
- [Revision binding](production-evidence-revision-binding.md), [pinned CI evidence](ci-pinned-evidence.md), [WebKit launch](webkit-nix-launch.md), and [Vitest counts](vitest-count-evidence.md)
- [Readiness evidence](readiness-evidence.md) and [WebKit compatibility lane](webkit-compatibility-lane-boundary.md)
- [Revision trend attribution](revision-trend-attribution.md)
- [GitHub Actions evidence extraction](github-actions-evidence-extraction.md)
