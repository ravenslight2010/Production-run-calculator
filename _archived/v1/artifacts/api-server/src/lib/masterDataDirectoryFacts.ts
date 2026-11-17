import type { MasterDataFact } from "@workspace/db/schema";
import { canonicalMasterJson } from "./masterDataPlan";

const fences = new Set(["run-calc-deleted-items", "run-calc-deleted-stamps", "run-calc-undeleted-stamps"]);
export const isFreshFenceDirectory = (fact: MasterDataFact) => fact.entity === "directories" && fences.has(fact.key);
const same = (a: unknown, b: unknown) => canonicalMasterJson(a) === canonicalMasterJson(b);
const nameKey = (name: string) => name.trim().toLowerCase();
function entries(value: unknown, list: boolean): Map<string, unknown> | null {
  if (value === undefined || value === null) return new Map();
  if (list) return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? new Map(value.map((item: string) => [nameKey(item), item])) : null;
  return typeof value === "object" && !Array.isArray(value) ? new Map(Object.entries(value)) : null;
}
function factEntries(fact: MasterDataFact, value: unknown, list: boolean): Map<string, unknown> | null {
  if (!fences.has(fact.key)) return entries(value, list);
  const namespaces = entries(value, false);
  if (!namespaces) return null;
  const result = new Map<string, unknown>();
  for (const [namespace, nested] of namespaces) {
    const values = entries(nested, fact.key === "run-calc-deleted-items");
    if (!values) return null;
    for (const [name, entry] of values) {
      const key = JSON.stringify([namespace, nameKey(name)]);
      const normalized = fact.key === "run-calc-deleted-items" ? nameKey(name) : entry;
      const previous = result.get(key);
      result.set(key, typeof previous === "number" && typeof normalized === "number" ? Math.max(previous, normalized) : normalized);
    }
  }
  return result;
}
function ownership(fact: MasterDataFact) {
  const list = Array.isArray(fact.before?.value) || Array.isArray(fact.after?.value);
  const before = factEntries(fact, fact.before?.value, list), after = factEntries(fact, fact.after?.value, list);
  if (!before || !after) throw new Error("Unsupported retained directory evidence");
  const keys = [...new Set([...before.keys(), ...after.keys()])].filter((key) =>
    before.has(key) !== after.has(key) || !same(before.get(key), after.get(key)));
  return { list, before, after, keys };
}
/** A name entry is a logical entity. Another name in the same document is not. */
export function directoryFactFingerprint(fact: MasterDataFact, current: Record<string, unknown> | null): unknown {
  const { list, keys } = ownership(fact);
  const namespaces = fences.has(fact.key) ? new Set(keys.map((key) => JSON.parse(key)[0] as string)) : null;
  const value = namespaces && current?.value && typeof current.value === "object"
    ? Object.fromEntries(Object.entries(current.value).filter(([key]) => namespaces.has(key))) : current?.value;
  const now = factEntries(fact, value, list);
  if (!now) return { malformed: true };
  return keys.map((key) => ({ key, present: now.has(key), value: now.get(key) ?? null }));
}
/** Server documents may contain other domains. Only changed typed entries are evidence. */
export function scopedDirectoryEvidence(facts: MasterDataFact[]): MasterDataFact[] {
  return facts.map((fact) => {
    if (fact.entity !== "directories" || Array.isArray(fact.before?.value) || Array.isArray(fact.after?.value)) return fact;
    const before = fact.before?.value as Record<string, unknown> ?? {}, after = fact.after?.value as Record<string, unknown> ?? {};
    const old: Record<string, unknown> = {}, next: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(before[key], after[key])) continue;
      if (fences.has(fact.key)) {
        const list = fact.key === "run-calc-deleted-items";
        const left = entries(before[key], list), right = entries(after[key], list);
        if (!left || !right) throw new Error("Unsupported changed name-fence evidence");
        const owned = [...new Set([...left.keys(), ...right.keys()])].filter((name) =>
          left.has(name) !== right.has(name) || !same(left.get(name), right.get(name)));
        old[key] = list ? owned.filter((name) => left.has(name)).map((name) => left.get(name))
          : Object.fromEntries(owned.filter((name) => left.has(name)).map((name) => [name, left.get(name)]));
        next[key] = list ? owned.filter((name) => right.has(name)).map((name) => right.get(name))
          : Object.fromEntries(owned.filter((name) => right.has(name)).map((name) => [name, right.get(name)]));
      } else {
        if (Object.hasOwn(before, key)) Object.defineProperty(old, key, { value: before[key], enumerable: true });
        if (Object.hasOwn(after, key)) Object.defineProperty(next, key, { value: after[key], enumerable: true });
      }
    }
    return { ...fact, before: fact.before ? { ...fact.before, value: old } : null,
      after: fact.after ? { ...fact.after, value: next } : null };
  });
}
/** Patch only the originally changed keys; retain unrelated later entries. */
export function restoreDirectoryFactValue(fact: MasterDataFact, current: Record<string, unknown> | null): unknown {
  const { list, before, keys } = ownership(fact);
  const owned = new Set(keys);
  if (list) {
    const result = [...(current?.value as string[] ?? [])].filter((name) => !owned.has(nameKey(name)));
    const original = fact.before?.value as string[] ?? [];
    original.forEach((name, index) => { if (owned.has(nameKey(name))) result.splice(Math.min(index, result.length), 0, name); });
    return result;
  }
  const result = { ...(current?.value as Record<string, unknown> ?? {}) };
  for (const key of keys) {
    if (!before.has(key)) delete result[key];
    else Object.defineProperty(result, key, { value: before.get(key), enumerable: true, configurable: true, writable: true });
  }
  return result;
}
