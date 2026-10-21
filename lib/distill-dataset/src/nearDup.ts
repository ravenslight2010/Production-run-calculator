/**
 * Near-duplicate detection via normalized shingles + Jaccard similarity.
 * Sized for hundreds–low thousands of workbook chunks (all-pairs is fine).
 */

export type ShingleMode = "word" | "char";

export type NearDupConfig = {
  /** n-gram size. Default 3 for words, 5 for chars if mode is char and unset. */
  shingleSize: number;
  shingleMode: ShingleMode;
  /** Jaccard threshold for a near-dup hit. Default 0.85 */
  threshold: number;
  /** Bump when normalize rules change. */
  normalizeVersion: number;
};

export const DEFAULT_NEAR_DUP_CONFIG: NearDupConfig = {
  shingleSize: 3,
  shingleMode: "word",
  threshold: 0.85,
  normalizeVersion: 1,
};

export type NearDupHit = {
  leftId: string;
  rightId: string;
  score: number;
};

export type TrainNearDupFlag = {
  flag: boolean;
  maxScore: number;
  matchedId?: string;
};

function resolveConfig(partial?: Partial<NearDupConfig>): NearDupConfig {
  const mode = partial?.shingleMode ?? DEFAULT_NEAR_DUP_CONFIG.shingleMode;
  const defaultSize =
    mode === "char" && partial?.shingleSize === undefined ? 5 : DEFAULT_NEAR_DUP_CONFIG.shingleSize;
  return {
    shingleSize: partial?.shingleSize ?? defaultSize,
    shingleMode: mode,
    threshold: partial?.threshold ?? DEFAULT_NEAR_DUP_CONFIG.threshold,
    normalizeVersion:
      partial?.normalizeVersion ?? DEFAULT_NEAR_DUP_CONFIG.normalizeVersion,
  };
}

/**
 * Stable text normalization for near-dup (versioned).
 * v1: NFC, lower case, collapse whitespace, trim.
 */
export function normalizeForNearDup(
  text: string,
  normalizeVersion: number = DEFAULT_NEAR_DUP_CONFIG.normalizeVersion,
): string {
  if (normalizeVersion !== 1) {
    throw new Error(
      `unsupported normalizeVersion: ${normalizeVersion} (only 1 is implemented)`,
    );
  }
  const nfc = text.normalize("NFC");
  return nfc.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a shingle set from normalized text.
 */
export function shingleSet(
  text: string,
  partialConfig?: Partial<NearDupConfig>,
): Set<string> {
  const config = resolveConfig(partialConfig);
  const normalized = normalizeForNearDup(text, config.normalizeVersion);
  const set = new Set<string>();

  if (normalized.length === 0) return set;

  if (config.shingleMode === "word") {
    const words = normalized.split(" ").filter((w) => w.length > 0);
    if (words.length === 0) return set;
    if (words.length < config.shingleSize) {
      set.add(words.join(" "));
      return set;
    }
    for (let i = 0; i <= words.length - config.shingleSize; i++) {
      set.add(words.slice(i, i + config.shingleSize).join(" "));
    }
    return set;
  }

  // char mode
  const s = normalized.replace(/ /g, "");
  if (s.length === 0) return set;
  if (s.length < config.shingleSize) {
    set.add(s);
    return set;
  }
  for (let i = 0; i <= s.length - config.shingleSize; i++) {
    set.add(s.slice(i, i + config.shingleSize));
  }
  return set;
}

/**
 * Jaccard similarity of two sets: |A∩B| / |A∪B|.
 * Empty vs empty → 1; empty vs non-empty → 0.
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  // Iterate the smaller set
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) {
    if (large.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard on two raw texts (normalize + shingle internally).
 */
export function jaccardTexts(
  left: string,
  right: string,
  partialConfig?: Partial<NearDupConfig>,
): number {
  const config = resolveConfig(partialConfig);
  return jaccard(
    shingleSet(left, config),
    shingleSet(right, config),
  );
}

/**
 * All pairs with score >= threshold. O(n²) — fine for small distill corpora.
 */
export function findNearDuplicates(
  items: Array<{ id: string; text: string }>,
  partialConfig?: Partial<NearDupConfig>,
): NearDupHit[] {
  const config = resolveConfig(partialConfig);
  const prepared = items.map((item) => ({
    id: item.id,
    set: shingleSet(item.text, config),
  }));
  const hits: NearDupHit[] = [];

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const score = jaccard(prepared[i].set, prepared[j].set);
      if (score >= config.threshold) {
        hits.push({
          leftId: prepared[i].id,
          rightId: prepared[j].id,
          score,
        });
      }
    }
  }
  return hits;
}

/**
 * For each train id, whether any eval (dev/holdout) item is a near-dup.
 * Feeds assessTrainSafety({ nearDuplicateOfHoldout }).
 */
export function trainNearDupFlags(
  train: Array<{ id: string; text: string }>,
  evalSet: Array<{ id: string; text: string }>,
  partialConfig?: Partial<NearDupConfig>,
): Map<string, TrainNearDupFlag> {
  const config = resolveConfig(partialConfig);
  const evalPrepared = evalSet.map((item) => ({
    id: item.id,
    set: shingleSet(item.text, config),
  }));

  const out = new Map<string, TrainNearDupFlag>();

  for (const t of train) {
    const tSet = shingleSet(t.text, config);
    let maxScore = 0;
    let matchedId: string | undefined;
    for (const e of evalPrepared) {
      const score = jaccard(tSet, e.set);
      if (score > maxScore) {
        maxScore = score;
        matchedId = e.id;
      }
    }
    const flag = maxScore >= config.threshold;
    out.set(t.id, {
      flag,
      maxScore,
      matchedId: flag ? matchedId : undefined,
    });
  }

  return out;
}
