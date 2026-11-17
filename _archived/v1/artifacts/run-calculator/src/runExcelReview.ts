import type { ImportParseResult, ImportCommitRun, ImportAliasPair } from "@/utils/runExcel";

export type FuzzyMatch = { value: string; score: number; exact: boolean };

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

export function exactMatch(candidate: string, options: string[]): string | null {
  const c = candidate.trim().toLowerCase();
  return c ? options.find((o) => o.trim().toLowerCase() === c) ?? null : null;
}

export function fuzzyMatch(candidate: string, options: string[]): FuzzyMatch[] {
  const c = candidate.trim().toLowerCase();
  if (!c) return [];
  const exact = exactMatch(candidate, options);
  if (exact) return [{ value: exact, score: 0, exact: true }];
  return options.map((value) => ({
    value,
    score: levenshtein(c, value.trim().toLowerCase()),
    ratio: levenshtein(c, value.trim().toLowerCase()) / Math.max(c.length, value.length, 1),
    exact: false,
  })).filter((m) => m.ratio <= 0.5).sort((a, b) => a.score - b.score).slice(0, 3)
    .map(({ value, score, exact: isExact }) => ({ value, score, exact: isExact }));
}

export function mergeImportRuns(runs: ImportCommitRun[]): ImportCommitRun[] {
  const order: string[] = [];
  const map = new Map<string, ImportCommitRun>();
  for (const run of runs) {
    const key = `${run.brand.trim().toLowerCase()}|||${run.flavor.trim().toLowerCase()}`;
    const previous = map.get(key);
    if (previous) {
      previous.casesPlanned += run.casesPlanned;
      if (run.notes.trim() && !previous.notes.split("; ").includes(run.notes.trim()))
        previous.notes = [previous.notes, run.notes.trim()].filter(Boolean).join("; ");
    } else {
      order.push(key);
      map.set(key, { ...run, notes: run.notes.trim() });
    }
  }
  return order.map((key) => map.get(key)!);
}

export function collectImportAliases(
  rows: { brand: string; flavor: string }[],
  brandChoice: Record<string, string>,
  flavorChoice: Record<string, string>,
  opts: { skip: string; create: string },
): ImportAliasPair[] {
  const { skip, create } = opts;
  const aliases = new Map<string, ImportAliasPair>();
  for (const row of rows) {
    const brand = row.brand.trim();
    const selectedBrand = brandChoice[brand.toLowerCase()] ?? skip;
    if (!brand || selectedBrand === skip) continue;
    const canonicalBrand = selectedBrand === create ? brand : selectedBrand;
    if (selectedBrand !== create && brand.toLowerCase() !== canonicalBrand.toLowerCase())
      aliases.set(`brand|${brand.toLowerCase()}`, { type: "brand", externalName: brand, canonicalName: canonicalBrand, brandContext: null });
    const flavor = row.flavor.trim();
    if (!flavor) continue;
    const selectedFlavor = flavorChoice[`${canonicalBrand.toLowerCase()}|||${flavor.toLowerCase()}`] ?? skip;
    if (selectedFlavor === skip || selectedFlavor === create) continue;
    if (flavor.toLowerCase() !== selectedFlavor.toLowerCase())
      aliases.set(`flavor|${canonicalBrand.toLowerCase()}|${flavor.toLowerCase()}`, { type: "flavor", externalName: flavor, canonicalName: selectedFlavor, brandContext: canonicalBrand });
  }
  return [...aliases.values()];
}

export type { ImportParseResult };