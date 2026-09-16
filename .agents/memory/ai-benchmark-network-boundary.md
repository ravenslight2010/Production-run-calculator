---
name: AI benchmark network boundary
description: Rules separating deterministic evaluation from intentional live-provider health checks.
---

Routine benchmark, test, and evaluation commands must not infer permission to
contact a provider from the presence of credentials. Provider-backed execution
requires an explicit live opt-in, and its results must be labeled as
non-deterministic, non-CI evidence.

Provider-unavailable, provider-failure, invalid-output, and deterministic-success
are separate outcomes. A live check must fail closed for the first three rather
than turning them into negative classifications or successful benchmark
evidence.

**Why:** Credentials are often present in developer and CI environments. Using
their presence as authorization can expose inputs, spend quota, and make
provider availability look like product-quality evidence.

**How to apply:** Inject fake provider clients at the first source-of-truth
boundary in tests. Require a conspicuous command-line opt-in before constructing
a real client, and keep live artifacts clearly separate from release or CI
claims.