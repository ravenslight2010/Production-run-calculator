import {
  normalizeAllergen,
  isAllergen,
  allergenSequenceWarnings,
  type Allergen,
  type AllergenSequenceItem,
} from "@workspace/allergen";
import {
  evaluateRules,
  type ProductionRule,
  type RuleSequenceItem,
} from "@workspace/production-rules";

// Pure schedule-ordering logic for a single production day (web + mobile parity).
//
// Given the runs planned for a day, this proposes an ordering that:
//   1. Schedules allergen runs at the END of the day (so the line can be cleaned
//      before a non-allergen product runs again) — the factory's allergen rule,
//      shared via @workspace/allergen.
//   2. Groups same brand + same die together to minimize line CHANGEOVERS
//      (setup/teardown between dissimilar products).
//   3. Honors factory-wide sequence PRODUCTION RULES (shared
//      @workspace/production-rules) as a metric, surfacing any that remain.
//
// It is purely advisory: it returns a SUGGESTED order plus before/after metrics
// so a human can review and apply it through the normal schedule-move path.
// Nothing here mutates input or writes data. The AI layer only narrates the
// result; all ordering and scoring is deterministic and lives here so web and
// mobile cannot drift.

export interface ScheduleRun {
  id: string;
  /** Human label for messaging, e.g. "Run 2 · Margherita". */
  label: string;
  brand: string;
  flavor: string;
  allergen: Allergen;
  /** Die/crust type; a change between adjacent runs is a changeover. */
  dieType?: string;
}

export interface ScheduleMetrics {
  /** Allergen-sequence advisories across consecutive runs. */
  allergenViolations: number;
  /** Factory sequence-rule violations across consecutive runs. */
  ruleViolations: number;
  /** Adjacent runs needing a brand/die changeover. */
  changeovers: number;
}

export interface ScheduleOptimizeResult {
  /** Suggested run order (run ids), best-first. */
  order: string[];
  /** The same runs in suggested order, for convenience. */
  ordered: ScheduleRun[];
  /** True when the suggested order differs from the input order. */
  changed: boolean;
  /** True when the suggested order is strictly better than the input. */
  improved: boolean;
  before: ScheduleMetrics;
  after: ScheduleMetrics;
}

/** Allergen ordering rank: non-allergen first (0), allergen runs last. */
function allergenRank(a: Allergen): number {
  return isAllergen(normalizeAllergen(a)) ? 1 : 0;
}

/** Changeover key — a change in brand OR die between adjacent runs is a setup. */
function changeoverKey(r: ScheduleRun): string {
  return `${r.brand.trim().toLowerCase()}|||${(r.dieType ?? "").trim().toLowerCase()}`;
}

function toAllergenItems(runs: ScheduleRun[]): AllergenSequenceItem[] {
  return runs.map((r) => ({
    id: r.id,
    label: r.label,
    allergen: normalizeAllergen(r.allergen),
  }));
}

function toRuleSequence(runs: ScheduleRun[]): RuleSequenceItem[] {
  return runs.map((r) => ({
    id: r.id,
    label: r.label,
    attributes: { allergen: normalizeAllergen(r.allergen) },
  }));
}

/** Count adjacent brand/die changeovers in the given order. */
export function countChangeovers(runs: ScheduleRun[]): number {
  let n = 0;
  for (let i = 1; i < runs.length; i++) {
    if (changeoverKey(runs[i]) !== changeoverKey(runs[i - 1])) n++;
  }
  return n;
}

/** Deterministic metrics for one ordering — what the UI compares. */
export function scheduleMetrics(
  runs: ScheduleRun[],
  rules: ProductionRule[] = [],
): ScheduleMetrics {
  const allergenViolations = allergenSequenceWarnings(toAllergenItems(runs)).length;
  // Only sequence-type rules apply to ordering; field/range rules need per-run
  // form values we don't model here. evaluateRules ignores non-matching rules.
  const sequenceRules = rules.filter((r) => r.type === "sequence");
  const ruleViolations =
    sequenceRules.length === 0
      ? 0
      : evaluateRules(sequenceRules, {
          fields: {},
          sequence: toRuleSequence(runs),
        }).length;
  return {
    allergenViolations,
    ruleViolations,
    changeovers: countChangeovers(runs),
  };
}

/** A single comparable score; lower is better. Violations dominate changeovers. */
function score(m: ScheduleMetrics): number {
  return (m.allergenViolations + m.ruleViolations) * 1000 + m.changeovers;
}

/**
 * Propose an ordering. Deterministic and stable: non-allergen runs first then
 * allergen runs (allergen end-of-day), grouped by brand then die then flavor to
 * minimize changeovers. Ties broken by original index so the result is stable.
 */
export function optimizeSchedule(
  runs: ScheduleRun[],
  rules: ProductionRule[] = [],
): ScheduleOptimizeResult {
  const before = scheduleMetrics(runs, rules);

  const indexed = runs.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const ar = allergenRank(a.r.allergen) - allergenRank(b.r.allergen);
    if (ar !== 0) return ar;
    // Within the same allergen tier, group same allergen together (egg vs soy).
    const al = normalizeAllergen(a.r.allergen).localeCompare(normalizeAllergen(b.r.allergen));
    if (al !== 0) return al;
    const brand = a.r.brand.trim().toLowerCase().localeCompare(b.r.brand.trim().toLowerCase());
    if (brand !== 0) return brand;
    const die = (a.r.dieType ?? "")
      .trim()
      .toLowerCase()
      .localeCompare((b.r.dieType ?? "").trim().toLowerCase());
    if (die !== 0) return die;
    const flavor = a.r.flavor.trim().toLowerCase().localeCompare(b.r.flavor.trim().toLowerCase());
    if (flavor !== 0) return flavor;
    return a.i - b.i;
  });

  const ordered = indexed.map((x) => x.r);
  const after = scheduleMetrics(ordered, rules);

  const order = ordered.map((r) => r.id);
  const changed = order.some((id, i) => id !== runs[i]?.id);
  const improved = score(after) < score(before);

  return { order, ordered, changed, improved, before, after };
}

/** Build the deterministic FACTS block the AI narrates (never raw run data). */
export function buildSchedulePromptBlock(result: ScheduleOptimizeResult): string {
  const lines: string[] = [];
  lines.push(`Runs to schedule: ${result.ordered.length}`);
  lines.push(
    `Current order issues — allergen-sequence: ${result.before.allergenViolations}, ` +
      `rule violations: ${result.before.ruleViolations}, changeovers: ${result.before.changeovers}`,
  );
  lines.push(
    `Suggested order issues — allergen-sequence: ${result.after.allergenViolations}, ` +
      `rule violations: ${result.after.ruleViolations}, changeovers: ${result.after.changeovers}`,
  );
  lines.push("Suggested run order:");
  result.ordered.forEach((r, i) => {
    const allergen = normalizeAllergen(r.allergen);
    lines.push(
      `  ${i + 1}. ${r.label} [brand: ${r.brand}, die: ${r.dieType || "—"}, allergen: ${allergen}]`,
    );
  });
  return lines.join("\n");
}
