# Approved AI Evaluation Tool Comparison

## Decision summary

**Decision:** do not adopt any archive, framework, package, fixture corpus, or
runtime dependency.

- **Autocontext:** **ADAPT** a small set of TypeScript test ideas, especially
  offline redaction, canonical serialization, idempotence, rollback/refusal,
  locking, and stable error-state assertions. Reject its Python harness, live
  provider/GPU paths, installer behavior, generated/repetitive test tree, and
  archive-specific application contracts.
- **Headroom:** **ADAPT** provider-neutral token-budget, cache, malformed-input,
  bounded adversarial, synthetic-workload, and benchmark-reporting invariants.
  Rewrite any selected behavior in TypeScript/Vitest. Reject the Rust/Python
  proxy implementation, native/FFI tooling, Redis/SQLite assumptions,
  provider-specific auth/pricing rules, and raw trace/session reporting.
- **Autoharness:** **REJECT** reuse from this upload. Some test concepts are
  useful, but the approved path does not establish an immutable upstream
  identity, source/test correspondence, dependency lock, or release identity.
  Its Python/pytest and host-hook architecture also does not fit the existing
  TypeScript/Vitest workflows.

No dependency, code, fixture, script, provider call, or archive content was
added to the project as part of this comparison.

## Approval and scope

The user explicitly approved all three candidates before archive-content
inspection. The review was read-only and limited to:

- `autocontext-main/autocontext/tests/`
- `autocontext-main/ts/tests/`
- `headroom-main/crates/headroom-core/tests/`
- `headroom-main/benchmarks/`
- `autoharness-main/tests/`

The exact uploaded filenames and SHA-256 identities remain recorded in
`docs/zip-asset-review-2026-09-14.md`. No other archive path was used to expand
the comparison. Nothing from the archives was executed, installed, copied, or
loaded with credentials.

## Existing project baseline

The project already has stronger foundations than any candidate provides as a
drop-in framework:

| Existing pattern | Evidence | Current value |
|---|---|---|
| Deterministic full-corpus regression | `lib/corpus-harness/src/corpus.test.ts`, `lib/corpus-harness/snapshots/` | Runs without a model, network, secret, or provider; checks snapshots and import invariants over the retained source corpus |
| Mocked provider contracts | `artifacts/api-server/src/routes/aiParseSpecSheet.route.test.ts`, `runSuggestions.integration.test.ts`, `costLimit.integration.test.ts`, `artifacts/api-server/src/lib/aiJsonRetry.test.ts` | Detects malformed output, provider failures, unexpected calls, cost limits, and deterministic fallbacks offline |
| Cache and deduplication contracts | `artifacts/api-server/src/lib/aiResultCache.test.ts` | Covers stable fingerprints, expiry, invalid rows, lock failure, cache outage, and retryable provider failures |
| Source-bound value benchmark | `scripts/src/second-pass-reviewer-benchmark.mts`, `docs/second-pass-reviewer-benchmark-2026-09-05.md` | Uses predeclared thresholds, source hashes, deterministic/model contribution accounting, and fail-closed cost evidence |
| Trigger benchmark with explicit failure states | `scripts/gemini_skill_trigger_benchmark.py`, `scripts/test_gemini_skill_trigger_benchmark.py`, `gemini-skill-trigger-benchmark.md` | Offline by default; live access requires `--live-provider`, is labeled as non-CI evidence, fails closed on provider/invalid-output states, and keeps those states separate from deterministic injected-adapter results |
| Privacy and retention policy | `docs/ai-data-retention-policy-2026-09-05.md`, `docs/ai-feature-value-audit-2026-09-05.md` | Requires scoped cleanup, bounded candidate sets, minimized reports, and corpus/review evidence rather than click telemetry |

The normal compatibility target is Node 24, TypeScript 5.9, pnpm workspaces,
and package-local Vitest. API and client suites are intentionally serialized.
Provider access is centralized but currently includes Gemini/OpenAI-specific
configuration and failure behavior.

## Candidate comparison

### 1. Autocontext

The approved paths contain a very large cross-language test catalog: 770 files
under the Python tests and 1,217 files under the TypeScript tests. The
TypeScript side uses Vitest, but it imports a large sibling source tree and
assumes Autocontext-specific CLI, build, storage, tracing, and control-plane
contracts. The Python side uses pytest, Pydantic, Typer, and the Autocontext
package. Hundreds of narrow tests, detector cases, generated/cross-runtime
fixtures, and golden files make the tree useful as an invariant catalog but
unsuitable for wholesale adoption.

| Dimension | Finding |
|---|---|
| Portability | The Vitest techniques are compatible in principle, but the tests are not portable because their imports, generated artifacts, package exports, commands, and state model belong to another application. The Python suite is outside the pnpm workflow. |
| Dependencies | Python requires pytest/Pydantic/Typer and the archive package. TypeScript uses Node filesystem, temp directory, subprocess, module, URL, and Vitest APIs plus the archive's source graph. No new dependency is justified. |
| Privacy | `autocontext-main/ts/tests/control-plane/production-traces/dataset/pipeline-redaction.test.ts` tests PII replacement, default removal of `rawProviderPayload`, and per-row redaction flags. Toxic/PII trace fixtures under `autocontext-main/autocontext/tests/fixtures/trace_exchange/` are untrusted data and must not be copied. |
| Provider assumptions | Python members include live E2E, Anthropic retry, training-provider, CUDA, and MLX tests. `autocontext-main/autocontext/tests/test_agent_live_e2e.py` contains network/setup and `curl ... \| sh` behavior, which is prohibited for this project. TypeScript tests also include provider and Anthropic detector assumptions. |
| Recommendation | **ADAPT** only provider-neutral test behaviors into project-owned Vitest tests. Reject the framework, Python suite, provider/GPU/live paths, installer behavior, and fixture reuse. |

Most useful design references:

- `autocontext-main/ts/tests/control-plane/production-traces/dataset/pipeline-redaction.test.ts`
  — redaction and provider-payload stripping.
- `autocontext-main/ts/tests/control-plane/production-traces/cli/ingest.test.ts`
  — dry-run nonmutation, locking, strict/advisory validation, and stable exits.
- `autocontext-main/ts/tests/control-plane/integration/flow-4-rollback.test.ts`
  and `flow-5-cascade-refusal.test.ts` — idempotence, rollback, and unsafe-cascade
  refusal.
- `autocontext-main/ts/tests/_fixtures/cross-runtime-emit/` — canonical
  serialization as a concept only; fixture content would require a separate
  review.

### 2. Headroom

The approved paths contain 12 Rust integration tests and a Python benchmark
tree. The Rust tests cover auth classification, cache control/backends,
tokenizer/compressor parity, and property tests. The Python side uses pytest,
custom benchmark runners, deterministic scenarios, cost/session calculations,
and JSON/Markdown reporting.

| Dimension | Finding |
|---|---|
| Portability | No reviewed file is TypeScript or Vitest. Token-budget, cache TTL, malformed-input, bounded adversarial, deterministic workload, and baseline-report concepts can be rewritten in TypeScript. |
| Dependencies | Direct use would add Cargo/Rust, Python/pytest, native tokenizer/compressor code, temporary SQLite, and optional Redis behavior. These dependencies are disproportionate to the useful concepts. |
| Privacy | Temporary isolated storage and synthetic scenarios are positive patterns. Reports must not retain raw prompts, traces, headers, or sessions. Deep/adversarial inputs need explicit size and time limits to avoid CI resource exhaustion. |
| Provider assumptions | `auth_mode.rs` encodes Anthropic/OpenAI/Gemini key formats, Bedrock signing, user agents, and subscription/OAuth precedence. Cache tests include Anthropic TTL/marker and Claude model assumptions. Cost/session benchmarks include Claude/Gemini profiles and hard-coded pricing that will age. |
| Recommendation | **ADAPT** only provider-neutral invariants and report structure. Reject the proxy/runtime, Rust/Python/native dependencies, backend services, provider auth/pricing logic, and raw trace/session outputs. |

Most useful design references:

- `headroom-main/crates/headroom-core/tests/cache_control.rs` — bounded JSON
  cases and property-style cache invariants.
- `headroom-main/crates/headroom-core/tests/tokenizer_proptest.rs` — token
  budget properties, if expressed against a project-owned abstraction.
- `headroom-main/benchmarks/adversarial_ccr_tests.py` — malformed, Unicode,
  nesting, race, and resource-bound cases, reduced to safe offline fixtures.
- `headroom-main/benchmarks/scenarios/conversations.py` and
  `scenarios/tool_outputs.py` — deterministic synthetic workload generation.
- `headroom-main/benchmarks/run_benchmarks.py` — baseline comparison and
  machine-readable reporting as concepts, not an imported runner.

### 3. Autoharness

The approved path contains 29 Python tests covering persistence, transcript
capture, lifecycle hooks, ledgers, counters, reflection/curation, subprocess
handoff, redaction, validation, and one live boundary.

| Dimension | Finding |
|---|---|
| Portability | Tests import `autoharness.*` and use pytest, Python filesystem/environment behavior, executable permissions, and subprocesses. No Node, TypeScript, pnpm, or Vitest implementation appears in the approved path. |
| Dependencies | Direct use requires the missing archive package and Python test environment. Hook names, sidecars, layers, skill stores, and child-process contracts belong to another host architecture. |
| Privacy | `test_capture.py`, `test_redact.py`, `test_validate.py`, and `test_skills_guard.py` show bounded capture, clipping, source nonmutation, redaction, safe-path, injection, and token-exfiltration checks. They do not establish encryption, retention/deletion guarantees, secure permissions, or network privacy. |
| Provider assumptions | Tests contain Claude/Hermes lineage hints, host-specific environment variables, executable handoff, and a live E2E boundary. The approved path does not establish a provider-neutral runtime contract. |
| Provenance | The approved members do not establish an immutable upstream URL/commit, dependency lock, release identity, or source/test correspondence. The upload review already marks this candidate provenance-gated. |
| Recommendation | **REJECT** reuse from this upload. Independently designed Vitest tests may cover similar bounded-capture and validation invariants, but this archive should not be their code or fixture source. |

## Gaps worth addressing without a new framework

The comparison found a small set of project-owned benchmark improvements that
could be useful if separately approved:

1. A common TypeScript result manifest for corpus, trigger, and provider-backed
   evaluations, recording corpus hash, thresholds, dependency versions,
   provider/model identity, token/cost/latency, retries, seed, privacy mode, and
   explicit unavailable/failed states.
2. The trigger benchmark enforces offline/no-network operation by default and
   uses dependency injection for deterministic tests, so ordinary CI cannot
   accidentally turn provider infrastructure into benchmark evidence. Its live
   provider check requires `--live-provider`, is explicitly non-CI evidence,
   and exits non-zero for unavailable, failed, or invalid provider output.
3. A small sanitized privacy fixture set for redaction, prompt minimization,
   provider-payload stripping, and output leakage assertions. It must contain
   synthetic data only and retain no raw workbook/photo/provider payload.
4. Provider-neutral token-budget and cache/property invariants expressed
   against existing project abstractions, without importing tokenizers,
   provider pricing, proxy auth logic, or a benchmark framework.

These are adaptation targets, not permission to implement them. Any future
coverage should remain deterministic by default, keep provider-backed checks
opt-in, preserve the project's fail-safe AI boundaries, and use existing pnpm
and Vitest workflows.

The third target is now implemented as a project-owned, bounded synthetic
fixture set at the second-pass benchmark report boundary. The reporter projects
observations onto an explicit aggregate-metric allowlist before serialization;
tests assert that personal data, encoded workbook/photo content, malformed
input, credentials, provider payloads/output, raw prompts, and conversation
text cannot enter the retained report. No archive fixture was copied.

## Final ranked recommendation

1. **Autocontext — ADAPT:** best source of directly relatable Vitest privacy,
   serialization, idempotence, and state-transition test ideas.
2. **Headroom — ADAPT:** useful secondary source for budget, cache/property,
   bounded adversarial, workload, and report-manifest ideas.
3. **Autoharness — REJECT:** useful concepts are generic enough to design
   independently, while current provenance and workflow compatibility are
   insufficient for reuse.

The project does **not** need a new provider-specific evaluation framework to
add benchmark coverage. The safest path is a small project-owned TypeScript
evaluation contract layered over existing deterministic corpus tests, mocked
provider tests, and opt-in live checks.
