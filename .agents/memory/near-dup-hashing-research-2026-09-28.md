# Near-Duplicate Hashing for Distill Datasets

**Date:** 2026-09-28  
**Purpose:** Choose a practical near-dup approach for train/dev/holdout leakage control on workbook-chunk text.  
**Integrates with:** `@workspace/distill-dataset` (`nearDuplicateOfHoldout` flag on `assessTrainSafety`).

---

## 1. Why it matters here

| Risk | Effect on distillation |
|------|------------------------|
| Train ≈ holdout chunk | Inflated Phase-0 / holdout scores; false “student is ready” |
| Same brand layout repeated | Model memorizes file template, fails new brands |
| Exact hash only | Misses “same sheet, one cell changed” or reordered columns |

Brand-group split already blocks **brand** leakage. Near-dup blocks **content** leakage across partitions.

Corpus size for PRC is small (hundreds–low thousands of chunks), so heavy LSH infrastructure is optional. Correctness and zero-deps matter more than web-scale throughput.

---

## 2. Technique comparison

| Method | Similarity notion | Strengths | Weaknesses | Fit for workbook chunks |
|--------|-------------------|-----------|------------|-------------------------|
| **Exact SHA-256** | Byte identity | Free, already have `contentSha256` | Misses near-dups | Necessary baseline only |
| **Character / word n-gram Jaccard** | Set overlap of shingles | Simple, interpretable, no deps | O(n²) pair checks | **Best default at our scale** |
| **MinHash (+ LSH)** | Approximate Jaccard | Scales to large n | Extra code/deps; overkill for &lt;10k | Later if corpus grows |
| **SimHash** | Hamming on fingerprint | Tiny fingerprint; good at small edits | Weaker on reorder/partial overlap | Optional second signal |
| **Embedding cosine** | Semantic | Catches paraphrase | Needs model; slower; overkill | Not for this gate |

**Recommendation for PRC:**  

1. **Normalize → word or char shingles → exact Jaccard** for candidate pairs across train vs (dev∪holdout).  
2. Threshold **≥ 0.85** (configurable) → flag `nearDuplicateOfHoldout`.  
3. Keep exact `contentSha256` equality as automatic reject.  
4. Add MinHash only if pair-wise Jaccard becomes slow.

---

## 3. Algorithm (default path)

### 3.1 Normalize (critical)

```text
1. Unicode NFC
2. Lowercase
3. Collapse whitespace
4. Optional: strip pure numeric tokens that are row indices (keep product numbers if policy says so)
5. Optional: drop very common spreadsheet boilerplate lines (headers repeated every file)
```

Normalization must be **stable and versioned** (store `normalizeVersion` next to threshold).

### 3.2 Shingles

| Mode | Typical k | When |
|------|-----------|------|
| Word shingles | k=3 | Readable multi-word overlap (default for prose-like dumps) |
| Char shingles | k=5–8 | Dense/tabular dumps where tokenization is messy |

Workbook extracts often look like semi-structured text → **start with word k=3**; validate on a few known near-dup pairs from the facility.

### 3.3 Jaccard

\[
J(A,B) = \frac{|A \cap B|}{|A \cup B|}
\]

- \( J = 1 \) → identical shingle sets (often exact or trivial rewrite)  
- \( J \ge 0.85 \) → treat as near-dup for **train vs holdout/dev** (conservative; tune on labeled pairs)  
- Compare **train candidates only against dev∪holdout** (and optionally within-train for dedup)

### 3.4 Complexity

For \( n \) examples, pair-wise is \( O(n^2 \cdot s) \) with \( s \) = shingle-set ops.  

At n = 5,000 this is fine in CI (seconds–tens of seconds in pure JS/TS).  
At n ≫ 50k, switch to MinHash LSH.

---

## 4. MinHash (upgrade path)

When needed:

1. Shingle as above.  
2. MinHash signature: 64–128 permutations.  
3. Estimate Jaccard ≈ fraction of agreeing signature slots.  
4. Optional LSH bands to avoid all-pairs.

TS options (if adding a dependency later):

- `minhash` (Duhaime) — classic JS MinHash + LSH  
- `@nlptools/distance` — MinHash + SimHash + LSH in TS  
- `lsh.ts` — typed MinHash + index  

**Prefer implementing plain Jaccard in-repo first** (no dep, easy audit). MinHash as optional module when measured slow.

---

## 5. Policy for distill partitions

| Pair | Action |
|------|--------|
| train ↔ holdout, J ≥ T | Block train membership (quarantine or drop) |
| train ↔ dev, J ≥ T | Prefer remove from train or from dev; never both |
| within train, J ≥ T | Keep one (prefer `verified: both` or newer Apply) |
| exact `contentSha256` match across partitions | Always block |

**Priority if conflict:** preserve **holdout** purity over training volume.

---

## 6. Suggested API for `@workspace/distill-dataset`

```ts
// Conceptual — pure functions, no I/O

export type NearDupConfig = {
  shingleSize: number;          // default 3 (words)
  shingleMode: "word" | "char"; // default "word"
  threshold: number;            // default 0.85
  normalizeVersion: 1;
};

export function normalizeForNearDup(text: string, version?: number): string;

export function shingleSet(
  text: string,
  config?: Partial<NearDupConfig>,
): Set<string>;

export function jaccard(a: Set<string>, b: Set<string>): number;

export type NearDupHit = {
  leftId: string;
  rightId: string;
  score: number;
};

/** All pairs with score >= threshold (caller supplies id + user-chunk text). */
export function findNearDuplicates(
  items: Array<{ id: string; text: string }>,
  config?: Partial<NearDupConfig>,
): NearDupHit[];

/**
 * For each train id, true if any dev/holdout item is near-dup.
 * Feeds assessTrainSafety({ nearDuplicateOfHoldout }).
 */
export function trainNearDupFlags(
  train: Array<{ id: string; text: string }>,
  evalSet: Array<{ id: string; text: string }>,
  config?: Partial<NearDupConfig>,
): Map<string, { flag: boolean; maxScore: number; matchedId?: string }>;
```

Wire-up:

```ts
const flags = trainNearDupFlags(trainChunks, devAndHoldoutChunks);
for (const example of candidates) {
  const f = flags.get(example.id);
  assessTrainSafety(example, {
    nearDuplicateOfHoldout: f?.flag ?? false,
    // brandInOtherPartition from assertBrandPartitionIntegrity pre-pass
  });
}
```

---

## 7. Threshold tuning (do once)

1. Hand-label 20–50 pairs: “same underlying sheet / too similar to eval” vs “legitimately different.”  
2. Sweep T ∈ {0.75, 0.80, 0.85, 0.90, 0.95}.  
3. Prefer **high precision** on holdout protection (fewer false “clean” leaks) over maximizing train size.  
4. Record chosen T + normalizeVersion + shingleMode in dataset manifest metadata.

Starting default: **0.85** word-3 Jaccard after normalize.

---

## 8. What not to do

| Avoid | Why |
|-------|-----|
| Semantic embeddings for this gate | Cost, nondeterminism, overkill |
| Only filename/brand matching | Misses cross-brand template clones if any |
| Threshold without labeled pairs | 0.85 is a prior, not gospel |
| Mutating holdout to “fix” train | Holdout is sacred |
| Running near-dup on assistant JSON only | Leakage is in **inputs** (user chunks); outputs can be similar by design |

---

## 9. CI placement

```text
dataset PR / nightly
  → load private texts by contentSha256
  → trainNearDupFlags(train, dev∪holdout)
  → fail if any train id would be accepted with flag=true
  → assertBrandPartitionIntegrity(manifest)
```

Keep private texts out of the public repo; CI job uses a secret store or encrypted artifact.

---

## 10. Bottom line

For Production Run Calculator’s distill corpus:

- **Default:** normalized **word 3-gram Jaccard ≥ 0.85** between train and dev/holdout.  
- **Exact SHA-256** remains the fast path for true duplicates.  
- **MinHash/LSH** only if n grows large enough that all-pairs hurts CI.  
- Implement as pure functions in `@workspace/distill-dataset` so `assessTrainSafety` stays a thin policy layer.

---

*Research 2026-09-28 — near-dup hashing choices sized for workbook-chunk distillation and train/eval integrity.*
