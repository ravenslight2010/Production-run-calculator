// Per-die line-setting defaults — server master-data glue (web).
//
// Managers can override the built-in die-size defaults (crusts/cycle, cycle
// speed, speed adjustment, Freeze tunnel time, extra case buffer) per die type under
// Manage Lists → Die Defaults. Stored factory-wide on the server (NOT part of
// the per-day sync payload) so overrides survive resets and fresh devices.
// The run form / setup editor resolve defaults through these overrides first,
// falling back to the hard-coded map in dieDefaults.ts.

import { dieDefaultsKey, type DieLineDefaults, type DieLineDefaultsOverrides } from "./dieDefaults";

export interface DieLineDefaultsEntry extends DieLineDefaults {
  name: string;
}

function coerceEntry(raw: unknown): DieLineDefaultsEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const entry: DieLineDefaultsEntry = {
    name,
    crustsPerCycle: num(r.crustsPerCycle),
    cycleSpeed: num(r.cycleSpeed),
    speedAdjustment: num(r.speedAdjustment),
    freezerTime: num(r.freezerTime),
    casesPerLayer: num(r.casesPerLayer),
  };
  for (const k of ["crustsPerCycle", "cycleSpeed", "speedAdjustment", "freezerTime", "casesPerLayer"] as const) {
    if (!Number.isFinite(entry[k])) return null;
  }
  // Optional tunnel overrides — present only when the manager set them.
  for (const k of ["preTunnelMin", "postTunnelMin"] as const) {
    if (r[k] !== undefined && r[k] !== null) {
      const n = num(r[k]);
      if (Number.isFinite(n) && n > 0) entry[k] = n;
    }
  }
  return entry;
}

export async function fetchDieLineDefaults(): Promise<DieLineDefaultsEntry[]> {
  const res = await fetch("/api/die-line-defaults");
  if (!res.ok) throw new Error(`List die line defaults failed (${res.status})`);
  const data = (await res.json()) as { entries: unknown };
  if (!Array.isArray(data.entries)) return [];
  return data.entries.map(coerceEntry).filter((e): e is DieLineDefaultsEntry => e !== null);
}

export async function saveDieLineDefaults(
  entries: DieLineDefaultsEntry[],
): Promise<DieLineDefaultsEntry[]> {
  const res = await fetch("/api/die-line-defaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(`Save die line defaults failed (${res.status})`);
  const data = (await res.json()) as { entries: unknown };
  if (!Array.isArray(data.entries)) return [];
  return data.entries.map(coerceEntry).filter((e): e is DieLineDefaultsEntry => e !== null);
}

export async function deleteDieLineDefaults(
  names: string[],
): Promise<DieLineDefaultsEntry[]> {
  const res = await fetch("/api/die-line-defaults", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) throw new Error(`Delete die line defaults failed (${res.status})`);
  const data = (await res.json()) as { entries: unknown };
  if (!Array.isArray(data.entries)) return [];
  return data.entries.map(coerceEntry).filter((e): e is DieLineDefaultsEntry => e !== null);
}

/** Build the overrides map dieDefaults.ts consumes, keyed by canonical die name. */
export function toOverridesMap(entries: DieLineDefaultsEntry[]): DieLineDefaultsOverrides {
  const out: DieLineDefaultsOverrides = {};
  for (const e of entries) {
    const key = dieDefaultsKey(e.name);
    if (!key) continue;
    const def: DieLineDefaults = {
      crustsPerCycle: e.crustsPerCycle,
      cycleSpeed: e.cycleSpeed,
      speedAdjustment: e.speedAdjustment,
      freezerTime: e.freezerTime,
      casesPerLayer: e.casesPerLayer,
    };
    if (e.preTunnelMin != null) def.preTunnelMin = e.preTunnelMin;
    if (e.postTunnelMin != null) def.postTunnelMin = e.postTunnelMin;
    out[key] = def;
  }
  return out;
}
