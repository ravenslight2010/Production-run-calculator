// Shared production-rules model for the run calculator (web + mobile parity).
//
// Managers define their own factory-wide production rules, modeled on the
// built-in allergen rule. Each rule has a name, a type with type-specific
// settings, an enforcement level, and an enabled flag:
//   - "flexible" rules WARN (shown inline, like the allergen warning boxes).
//   - "strict"   rules BLOCK starting a run until the violation is resolved.
//
// This module is pure so both apps evaluate rules identically. Rules are stored
// factory-wide on the server (not in the per-day sync payload) and edited by
// managers only; this module only models and evaluates them.

import {
  normalizeAllergen,
  allergenLabel,
  type Allergen,
} from "@workspace/allergen";

export type RuleEnforcement = "flexible" | "strict";

export type RuleType = "required-field" | "numeric-range" | "sequence";

// A single production rule. The shape is intentionally flat (rather than a
// discriminated union) so it serializes cleanly to the API/DB and is easy to
// edit field-by-field in the UI. Only the fields relevant to `type` are used;
// the rest are ignored by evaluation.
export interface ProductionRule {
  id: string;
  name: string;
  type: RuleType;
  enforcement: RuleEnforcement;
  enabled: boolean;
  // "required-field" and "numeric-range": which run field this rule checks.
  field?: string;
  // "numeric-range": inclusive bounds. null/undefined means "no bound on this side".
  min?: number | null;
  max?: number | null;
  // "sequence": which run attribute the transition rule applies to, and the
  // disallowed `before` -> `after` transition between consecutive runs.
  attribute?: string;
  before?: string;
  after?: string;
}

// ---------------------------------------------------------------------------
// Field catalog
// ---------------------------------------------------------------------------

export type RuleFieldKind = "text" | "number";

export interface RuleFieldDef {
  key: string;
  label: string;
  kind: RuleFieldKind;
}

// The run fields a manager can build required-field / numeric-range rules on.
// Both apps map their own run state onto these keys so evaluation is identical.
export const RULE_FIELDS: readonly RuleFieldDef[] = [
  { key: "brand", label: "Brand", kind: "text" },
  { key: "flavor", label: "Flavor", kind: "text" },
  { key: "casesNeeded", label: "Cases needed", kind: "number" },
  { key: "lineSpeed", label: "Line speed (ppm)", kind: "number" },
  { key: "targetDoughballWeight", label: "Target doughball weight (oz)", kind: "number" },
  { key: "sauceOzPerPizza", label: "Sauce oz per pizza", kind: "number" },
  { key: "dieType", label: "Die type", kind: "text" },
];

export function ruleFieldDef(key: string | undefined): RuleFieldDef | undefined {
  if (!key) return undefined;
  return RULE_FIELDS.find((f) => f.key === key);
}

export function ruleFieldLabel(key: string | undefined): string {
  return ruleFieldDef(key)?.label ?? key ?? "";
}

// ---------------------------------------------------------------------------
// Sequence attributes
// ---------------------------------------------------------------------------

export interface RuleAttributeDef {
  key: string;
  label: string;
  /** Allowed values for the before/after pickers, with display labels. */
  values: readonly { value: string; label: string }[];
  /** Normalize an arbitrary stored/synced value onto an allowed value. */
  normalize: (v: unknown) => string;
}

// Sequence rules currently operate on the allergen attribute, generalizing the
// built-in allergen warning so managers can express their own disallowed
// transitions (e.g. "never run Soy immediately after None").
export const RULE_ATTRIBUTES: readonly RuleAttributeDef[] = [
  {
    key: "allergen",
    label: "Allergen",
    values: [
      { value: "none", label: "None" },
      { value: "egg", label: "Egg" },
      { value: "soy", label: "Soy" },
    ],
    normalize: (v) => normalizeAllergen(v) as string,
  },
];

export function ruleAttributeDef(key: string | undefined): RuleAttributeDef | undefined {
  if (!key) return undefined;
  return RULE_ATTRIBUTES.find((a) => a.key === key);
}

function attributeValueLabel(attribute: string | undefined, value: string): string {
  const def = ruleAttributeDef(attribute);
  if (!def) return value;
  if (def.key === "allergen") return allergenLabel(value as Allergen);
  return def.values.find((x) => x.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

export type RuleFieldValue = string | number | null | undefined;

export interface RuleSequenceItem {
  id: string;
  /** Human label for messaging, e.g. "Run 2 · Margherita". */
  label: string;
  /** Attribute values keyed by attribute key, e.g. { allergen: "egg" }. */
  attributes: Record<string, string>;
}

export interface RuleRunContext {
  /** The run being evaluated: field values keyed by RULE_FIELDS keys. */
  fields: Record<string, RuleFieldValue>;
  /** A human label for the run being evaluated (for messages). */
  runLabel?: string;
  /** The full day's ordered run sequence, used by sequence rules. */
  sequence?: RuleSequenceItem[];
  /** The id of the run being evaluated within `sequence` (for sequence rules). */
  currentRunId?: string;
}

export interface RuleViolation {
  ruleId: string;
  name: string;
  enforcement: RuleEnforcement;
  message: string;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const MAX_NAME_LEN = 120;
const MAX_VALUE_LEN = 120;

export function isRuleType(v: unknown): v is RuleType {
  return v === "required-field" || v === "numeric-range" || v === "sequence";
}

export function isRuleEnforcement(v: unknown): v is RuleEnforcement {
  return v === "flexible" || v === "strict";
}

function clampStr(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").trim().slice(0, max);
}

function toFiniteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Coerce an arbitrary persisted/synced object onto a well-formed ProductionRule,
// or null if it is too malformed to keep (no id, bad type/enforcement, or the
// type-specific settings are missing). Used by both the server (on save) and the
// clients (on load) so every layer agrees on what a valid rule is.
export function normalizeRule(input: unknown): ProductionRule | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = clampStr(r.id, 64);
  if (!id) return null;
  if (!isRuleType(r.type)) return null;
  const enforcement = isRuleEnforcement(r.enforcement) ? r.enforcement : "flexible";
  const name = clampStr(r.name, MAX_NAME_LEN);
  const enabled = r.enabled !== false;

  const base: ProductionRule = {
    id,
    name: name || defaultRuleName(r.type),
    type: r.type,
    enforcement,
    enabled,
  };

  if (r.type === "required-field") {
    const field = clampStr(r.field, 64);
    if (!field || !ruleFieldDef(field)) return null;
    base.field = field;
    return base;
  }

  if (r.type === "numeric-range") {
    const field = clampStr(r.field, 64);
    const def = ruleFieldDef(field);
    if (!def || def.kind !== "number") return null;
    const min = toFiniteOrNull(r.min);
    const max = toFiniteOrNull(r.max);
    // A range with neither bound checks nothing — reject it.
    if (min === null && max === null) return null;
    base.field = field;
    base.min = min;
    base.max = max;
    return base;
  }

  // sequence
  const attribute = clampStr(r.attribute, 64) || "allergen";
  const def = ruleAttributeDef(attribute);
  if (!def) return null;
  const before = def.normalize(clampStr(r.before, MAX_VALUE_LEN));
  const after = def.normalize(clampStr(r.after, MAX_VALUE_LEN));
  base.attribute = attribute;
  base.before = before;
  base.after = after;
  return base;
}

export function defaultRuleName(type: RuleType): string {
  switch (type) {
    case "required-field":
      return "Required field";
    case "numeric-range":
      return "Numeric range";
    case "sequence":
      return "Sequence rule";
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function isFieldEmpty(value: RuleFieldValue, kind: RuleFieldKind): boolean {
  if (kind === "number") {
    const n = toFiniteOrNull(value);
    return n === null || n <= 0;
  }
  return clampStr(value, MAX_VALUE_LEN) === "";
}

function evaluateRequiredField(rule: ProductionRule, ctx: RuleRunContext): RuleViolation | null {
  const def = ruleFieldDef(rule.field);
  if (!def) return null;
  const value = ctx.fields[def.key];
  if (!isFieldEmpty(value, def.kind)) return null;
  return {
    ruleId: rule.id,
    name: rule.name,
    enforcement: rule.enforcement,
    message: `${def.label} is required but not set.`,
  };
}

function evaluateNumericRange(rule: ProductionRule, ctx: RuleRunContext): RuleViolation | null {
  const def = ruleFieldDef(rule.field);
  if (!def || def.kind !== "number") return null;
  const value = toFiniteOrNull(ctx.fields[def.key]);
  // No value to check against the range — treat as 0 so an unset required-ish
  // value still trips a min bound (e.g. "line speed must be at least 50").
  const n = value ?? 0;
  const { min, max } = rule;
  const belowMin = min !== null && min !== undefined && n < min;
  const aboveMax = max !== null && max !== undefined && n > max;
  if (!belowMin && !aboveMax) return null;
  let bounds: string;
  if (min !== null && min !== undefined && max !== null && max !== undefined) {
    bounds = `between ${min} and ${max}`;
  } else if (min !== null && min !== undefined) {
    bounds = `at least ${min}`;
  } else {
    bounds = `at most ${max}`;
  }
  return {
    ruleId: rule.id,
    name: rule.name,
    enforcement: rule.enforcement,
    message: `${def.label} (${n}) must be ${bounds}.`,
  };
}

function evaluateSequence(rule: ProductionRule, ctx: RuleRunContext): RuleViolation | null {
  const def = ruleAttributeDef(rule.attribute);
  if (!def) return null;
  const seq = ctx.sequence ?? [];
  if (seq.length < 2) return null;
  const before = def.normalize(rule.before);
  const after = def.normalize(rule.after);
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1];
    const next = seq[i];
    // When evaluating a specific run, only report transitions that involve it.
    if (ctx.currentRunId && prev.id !== ctx.currentRunId && next.id !== ctx.currentRunId) {
      continue;
    }
    const prevVal = def.normalize(prev.attributes[def.key]);
    const nextVal = def.normalize(next.attributes[def.key]);
    if (prevVal === before && nextVal === after) {
      return {
        ruleId: rule.id,
        name: rule.name,
        enforcement: rule.enforcement,
        message:
          `${def.label}: running ${attributeValueLabel(rule.attribute, after)} ` +
          `(${next.label}) immediately after ${attributeValueLabel(rule.attribute, before)} ` +
          `(${prev.label}) is not allowed.`,
      };
    }
  }
  return null;
}

export function evaluateRule(rule: ProductionRule, ctx: RuleRunContext): RuleViolation | null {
  if (!rule.enabled) return null;
  switch (rule.type) {
    case "required-field":
      return evaluateRequiredField(rule, ctx);
    case "numeric-range":
      return evaluateNumericRange(rule, ctx);
    case "sequence":
      return evaluateSequence(rule, ctx);
    default:
      return null;
  }
}

// Evaluate all rules against a run context, returning every violation in rule
// order. Callers split on `enforcement`: "flexible" -> warn inline,
// "strict" -> block starting the run.
export function evaluateRules(rules: ProductionRule[], ctx: RuleRunContext): RuleViolation[] {
  const out: RuleViolation[] = [];
  for (const rule of rules) {
    const v = evaluateRule(rule, ctx);
    if (v) out.push(v);
  }
  return out;
}

export function hasStrictViolation(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.enforcement === "strict");
}

// Convenience: make a blank rule of a given type with sensible defaults, for the
// "Add rule" affordance in the editor.
export function newRule(id: string, type: RuleType): ProductionRule {
  const base: ProductionRule = {
    id,
    name: defaultRuleName(type),
    type,
    enforcement: "flexible",
    enabled: true,
  };
  if (type === "required-field") {
    base.field = RULE_FIELDS[0].key;
  } else if (type === "numeric-range") {
    base.field = RULE_FIELDS.find((f) => f.kind === "number")?.key ?? RULE_FIELDS[0].key;
    // Seed a harmless lower bound so the rule is immediately persistable; a
    // bound-less range is rejected by normalizeRule, which would make the
    // manager UI's "Add rule" silently no-op. The manager edits this to a
    // meaningful min/max afterwards.
    base.min = 0;
    base.max = null;
  } else {
    base.attribute = "allergen";
    base.before = "none";
    base.after = "egg";
  }
  return base;
}
