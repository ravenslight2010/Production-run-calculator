import { inventoryClientId } from "./inventoryShared";

export type ProfileDataHealthFinding = {
  id: string;
  profileKey: string;
  brand: string;
  flavor: string;
  recipeKind: "dough" | "sauce";
  status: string;
  currentName: string;
  expectedName: string;
  repairable: boolean;
  message: string;
};

export type ProfileDataHealthRepair = {
  id: string;
  profileKey: string;
  recipeKind: "dough" | "sauce";
  fields: string[];
  previousValues: Record<string, unknown>;
  nextValues: Record<string, unknown>;
};

export type DataHealthFinding = {
  id: string;
  category: "profile-links" | "profiles" | "dough" | "sauce" | "cheese" | "mixes" | "ingredients" | "aliases" | "scheduled-runs" | "import-review" | "cleanup-history";
  severity: "info" | "warning" | "error";
  repairability: "safe" | "review";
  brand: string;
  flavor: string;
  recipe: string;
  message: string;
  proposedRepair: string;
  affectedRecord: string;
  protectedValue: boolean;
  source: "profile-health" | "master-data" | "saved-spec" | "cleanup";
  sourceRoute: "setupProfiles" | "import" | "merge" | "audit" | "dough" | "sauce" | "cheeseRecipes" | "mixes" | "ingredientTypes";
  preview?: {
    before: string;
    after: string;
    changes?: Array<{ field: string; before: string; after: string }>;
  };
  profileFinding?: ProfileDataHealthFinding;
};

export type DataHealthRepair = {
  repairType: "profile-link" | "delete-alias";
  findingId: string;
  profileKey?: string;
  recipeKind?: "dough" | "sauce";
  fields?: string[];
  previousValues?: Record<string, unknown>;
  nextValues?: Record<string, unknown>;
  afterStamp?: number;
  runs?: unknown[];
  source?: "import" | "spec" | "merge";
  rowId?: number;
  externalName?: string;
  canonicalName?: string;
  context?: string | null;
};

export type DataHealthWorkspace = {
  findings: DataHealthFinding[];
  safeRepairs: DataHealthRepair[];
  summary: Record<string, number>;
  cleanupHistory: {
    appliedAt: string | null;
    summary: {
      scannedProfiles: number;
      correctedProfiles: number;
      skippedStarted: number;
      removedStubs: { dough: number; sauce: number; cheese: number; mix: number };
    };
  } | null;
  repairBatches: Array<{
    id: string; actor: string; appliedAt: string; undoneAt: string | null; status: string;
    summary: { applied: number; skipped: number; failed: number; repairedRuns: number; undoable?: boolean };
  }>;
};

export type ProfileDataHealthReport = {
  findings: ProfileDataHealthFinding[];
  safeRepairs: ProfileDataHealthRepair[];
  summary: Record<string, number>;
};

export type ProfileDataHealthApplyResult = {
  before: ProfileDataHealthReport;
  after: ProfileDataHealthReport;
  applied: unknown[];
  batchId: string | null;
  outcome?: { applied: number; skipped: number; failed: number; repairedRuns: number };
  summary: { repairedProfiles: number; repairedRuns: number };
};

export async function undoProfileDataHealthRepair(batchId: string): Promise<{ batchId: string; summary: { applied: number; skipped: number; failed: number; repairedRuns: number } }> {
  const res = await fetch(`/api/profile-data/health-check/batches/${encodeURIComponent(batchId)}/undo`, {
    method: "POST",
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to undo profile data repairs: ${res.status}`);
  return await res.json();
}

export async function fetchProfileDataHealth(): Promise<ProfileDataHealthReport> {
  const res = await fetch("/api/profile-data/health-check", { headers: { "x-client-id": inventoryClientId() } });
  if (!res.ok) throw new Error(`Failed to check profile data health: ${res.status}`);
  return ((await res.json()) as { report: ProfileDataHealthReport }).report;
}

export async function fetchDataHealthWorkspace(): Promise<DataHealthWorkspace> {
  const res = await fetch("/api/profile-data/health-workspace", { headers: { "x-client-id": inventoryClientId() } });
  if (!res.ok) throw new Error(`Failed to load data health workspace: ${res.status}`);
  return ((await res.json()) as { workspace: DataHealthWorkspace }).workspace;
}

export async function applyProfileDataHealthRepairs(findingIds: string[]): Promise<ProfileDataHealthApplyResult> {
  const res = await fetch("/api/profile-data/health-check/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId() },
    body: JSON.stringify({ findingIds }),
  });
  if (!res.ok) throw new Error(`Failed to apply profile data repairs: ${res.status}`);
  return await res.json() as ProfileDataHealthApplyResult;
}

export async function applyDataHealthRepairs(findingIds: string[]): Promise<ProfileDataHealthApplyResult> {
  const res = await fetch("/api/profile-data/health-check/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId() },
    body: JSON.stringify({ findingIds }),
  });
  if (!res.ok) throw new Error(`Failed to apply data health repairs: ${res.status}`);
  return await res.json() as ProfileDataHealthApplyResult;
}