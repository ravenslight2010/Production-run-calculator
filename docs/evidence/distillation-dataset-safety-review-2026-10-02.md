# Distillation dataset safety review — no-go for package integration

**Review date:** 2026-10-02
**Reviewed repository revision:** `87407c209a2a7d9cd179986dc9eb46ed579529fc`
**Benchmark evidence:** `docs/evidence/local-spec-import-benchmark-blocker-2026-10-02.md`
**Privacy:** Metadata only. No workbook text, private examples, or provider payloads are retained here.

## Decision

Do not add or integrate a distillation dataset package under the current evidence. The available local-model benchmark is inconclusive: it has zero independently verified spec-import gold cases and no approved local inference endpoint or model identity. This is a no-go for preparing training data now, not a measured finding that Gemini is better and not a permanent decision against training.

The benchmark report is bound to revision `7f41f4931c459a3f273af7554d5527503d1d98f9`, not the reviewed repository revision above. The current checkout still declares `SPEC_PARSE_VERSION` 41, but no newer, revision-bound provider comparison was found. Reassess before training or provider changes when verified gold cases and an approved endpoint exist.

## Archive comparison

| Archive | ZIP SHA-256 | Contents |
| --- | --- | --- |
| `distill-dataset-lib-2026-09-28_1790731446507.zip` | `4ef47ff974d9eeac19da6580e25d782e34b50e98eefa9db6c1e552b2695ae39e` | Nine entries: README, package metadata, `src/index.ts` and its tests, `src/nearDup.ts` and its tests, and tsconfig. |
| `distill-dataset-lib-2026-09-28_1790731446539.zip` | `551b5b4137f5ef45d2baa49bcc45ed8a352bb50b8d8fe8437ad2087e5f4c91f3` | Seven entries: README, package metadata, `src/index.ts` and its tests, and tsconfig. It omits the near-duplicate module and its tests. |

The two archives share the same core implementation, core tests, package metadata, and tsconfig. The larger archive adds pure TypeScript near-duplicate helpers and tests, exports them from the package entry point, and documents an intentional default policy: normalized word 3-gram Jaccard with threshold 0.85, normalization version 1, and all-pairs comparison for the small corpus. It is the more complete proposal, not an approved or integrated package.

The near-duplicate proposal still needs hardening before use. Empty text becomes an empty shingle set, and two empty sets score as 1, so empty examples are reported as duplicates rather than explicitly rejected or excluded. Result and tie ordering follow caller input order; IDs and duplicate IDs are not validated. The supplied tests do not cover these cases.

## Gap patch and repository fit

The attached gap patch proposes:

- rejecting assistant markdown fences with a whitespace-tolerant check;
- optional exact gold-value comparisons;
- exact system-prompt and `SPEC_PARSE_VERSION` checks; and
- a cross-partition duplicate check using manifest content hashes.

These are useful gates but do not establish their own provenance. The patch trusts a caller-supplied `contentSha256` instead of hashing the submitted user text, accepts caller-supplied gold values without binding them to source evidence, and trusts the supplied hash in the partition check. The submitted example ID is also not bound to content. The proposed gold-value comparison therefore cannot prove that a label came from a workbook or a reviewed human Apply.

The current benchmark report says the production output type has no separately declared output-schema version. Any future validator must pin the production prompt identity and parse/cache version, and explicitly define how the output schema is identified; it must not invent a schema version or treat deterministic parser snapshots as independent gold.

The corpus-harness snapshot follows the existing metadata-only evaluation convention and binds the retained source-workbook corpus by hash. Its deterministic outputs are regression expectations, not independent field-level labels; they do not replace source-backed gold for training or provider-quality scoring.

The proposals broadly match `lib/ai-evaluation`'s use of versioned manifests, explicit provenance, and metadata-only retained evidence. However, `toManifestEntry` only drops message content; it does not ensure free-form IDs or brand codes are approved, non-identifying metadata. A future manifest writer must use an explicit metadata allow-list and keep raw workbook text and private examples outside Git. This review creates no manifest or example files.

## Evidence needed to revisit

1. Create an access-controlled set of independently verified, source-backed spec-import gold cases. Keep the underlying workbook text and examples outside Git.
2. Approve and identify a local inference endpoint/model, then run the provider comparison on identical, frozen cases and prompts.
3. Bind each future example ID and content digest to the actual submitted text; bind gold fields to source evidence or an independently reviewed Apply record.
4. Before accepting a package, define empty-input behavior, deterministic report ordering, exact-duplicate partition enforcement, prompt/parse/schema pinning, and a manifest metadata allow-list. Preserve and extend the larger archive's near-duplicate tests rather than silently omitting that module.

Until these gates are met, add no training dataset package, training examples, or raw workbook data. The queued verified-backfill and conditional-training work remains gated on subsequent evidence.
