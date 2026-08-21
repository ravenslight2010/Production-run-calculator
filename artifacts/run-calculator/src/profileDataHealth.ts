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

export type DataHealthFinding = {
  id: string;
  category: "profile-links" | "recipe-records" | "import-review" | "cleanup-history";
  severity: "info" | "warning" | "error";
  repairability: "safe" | "review";
  brand: string;
  flavor: string;
  recipe: string;
  message: string;
  proposedRepair: string;
  source: "profile-health" | "saved-spec" | "cleanup";
  sourceRoute: "setupProfiles" | "import" | "merge" | "audit";
  profileFinding?: ProfileDataHealthFinding;
};

export type DataHealthWorkspace = {
  findings: DataHealthFinding[];
  safeRepairs: unknown[];
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
};

export type ProfileDataHealthReport = {
  findings: ProfileDataHealthFinding[];
  safeRepairs: unknown[];
  summary: Record<string, number>;
};

export type ProfileDataHealthApplyResult = {
  before: ProfileDataHealthReport;
  after: ProfileDataHealthReport;
  applied: unknown[];
  summary: { repairedProfiles: number; repairedRuns: number };
};

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

export async function applyProfileDataHealthRepairs(): Promise<ProfileDataHealthApplyResult> {
  const res = await fetch("/api/profile-data/health-check/apply", {
    method: "POST",
    headers: { "x-client-id": inventoryClientId() },
  });
  if (!res.ok) throw new Error(`Failed to apply profile data repairs: ${res.status}`);
  return await res.json() as ProfileDataHealthApplyResult;
}