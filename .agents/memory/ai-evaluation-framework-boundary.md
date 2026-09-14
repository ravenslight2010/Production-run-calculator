---
name: AI evaluation framework boundary
description: How to adapt external AI benchmark ideas without importing provider-specific harnesses.
---

Keep AI evaluation project-owned, offline by default, and aligned with the
existing TypeScript/Vitest workflows. External harnesses may supply
provider-neutral invariants, but their runtimes, provider adapters, fixture
corpora, live tests, pricing tables, and report payloads are not dependencies.

**Why:** The project already has deterministic corpus tests, mocked provider
contracts, cache tests, and source-bound value benchmarks. Reviewed external
harnesses added useful redaction, budget, property, and reporting ideas but
also introduced Python/Rust/native tooling, provider assumptions, untrusted
fixtures, or incomplete provenance.

**How to apply:** Recreate only the smallest useful invariant in project-owned
TypeScript. Keep normal CI no-network, make provider checks opt-in, use
synthetic minimized privacy fixtures, and record provider/model identity,
source hashes, thresholds, costs, retries, and unavailable-versus-failed
states in any shared evaluation result contract.

For comparable retained runs, bind three identities separately: the source
corpus, the produced evidence, and the evaluator implementation. Never reuse
one digest for another; represent unavailable historical identity explicitly.
Privacy metadata must also describe retained normalized queries/model output,
not only whether the raw provider envelope was discarded.

At a release boundary, matching the corpus alone is insufficient. Exact-match
the thresholds, dependencies, evidence hash and type, evaluator hash, and
provider/model identity against the reviewed canonical contract.

**Why:** A valid manifest with the same corpus can still describe substituted
evaluator code, altered acceptance criteria, different output, or another
provider model and is therefore not comparable release proof.

**How to apply:** Derive trusted expectations from the canonical manifest at
the reviewed revision, require hashed evidence and evaluator provenance, and
reject legacy or unavailable identities rather than translating them.