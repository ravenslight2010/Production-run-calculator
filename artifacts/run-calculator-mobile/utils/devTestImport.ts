import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { ImportCommit } from "@/components/ExcelImportModal";

// ─── Dev-only browser test hook (shared by all import entry points) ─────────
// The full re-import flow (navigate → file pick → confirm modal → per-run
// "Case count changed" dialogs) is too long for the UI-test harness's hard
// iteration cap. In dev on web ONLY, a staged ImportCommit left in
// localStorage under "rc_test_import" (shape:
// { screen?: "schedule"|"summary"|"master-data",
//   byDate: [{ date, runs: [{ brand, flavor, casesPlanned, notes }] }] })
// is committed through the EXACT same commit path the file picker uses — so
// skipAlreadyRanRuns, buildCaseUpdateOffers, promptCaseUpdates, and
// updateRunSettingsById are all exercised in situ; only the file picker and
// confirm modal are skipped. Three screens share this identical wiring
// (Schedule, Summary tab, Master Data); the staged `screen` field selects
// which one commits (default "schedule" for back-compat), so a test can
// verify each entry point independently. The commit waits until every
// today-dated row's matching in-progress run has hydrated from live sync
// (firing earlier would find no matches and import the rows as plain
// scheduled runs). The key is consumed one-shot before committing. Stripped
// from production builds by the __DEV__ guard.
// See .local/fixtures/setup-case-update-test.mjs for the full pre-seed.

export type DevTestImportScreen = "schedule" | "summary" | "master-data";

type StagedImport = Partial<ImportCommit> & { screen?: DevTestImportScreen };

type MinimalRun = {
  startedAt?: number | null;
  endedAt?: number | null;
  settings: { brand: string; flavor: string };
};

export function useDevTestImport(opts: {
  screen: DevTestImportScreen;
  allRuns: MinimalRun[];
  today: string;
  commit: (payload: ImportCommit) => void;
}): void {
  const { screen, allRuns, today, commit } = opts;
  const firedRef = useRef(false);
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web") return;
    if (firedRef.current) return;
    let staged: StagedImport | null = null;
    try {
      const raw = globalThis.localStorage?.getItem("rc_test_import");
      if (!raw) return;
      staged = JSON.parse(raw) as StagedImport;
    } catch {
      return;
    }
    if (!staged || !Array.isArray(staged.byDate)) return;
    if ((staged.screen ?? "schedule") !== screen) return;
    const key = (brand: string, flavor: string) =>
      `${(brand ?? "").trim().toLowerCase()}|||${(flavor ?? "").trim().toLowerCase()}`;
    const inProgress = new Set(
      allRuns
        .filter((r) => r.startedAt && !r.endedAt)
        .map((r) => key(r.settings.brand, r.settings.flavor)),
    );
    const todayRows = staged.byDate
      .filter((d) => d.date === today)
      .flatMap((d) => d.runs ?? []);
    const ready = todayRows.every((row) => inProgress.has(key(row.brand, row.flavor)));
    if (!ready) return;
    firedRef.current = true;
    try {
      globalThis.localStorage?.removeItem("rc_test_import");
    } catch {
      /* ignore */
    }
    commit({
      date: today,
      runs: [],
      createBrands: staged.createBrands ?? [],
      createFlavors: staged.createFlavors ?? [],
      multiDay: true,
      byDate: staged.byDate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRuns, today]);
}
