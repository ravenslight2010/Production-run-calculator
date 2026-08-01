import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { computeCalc, runLabel, type RunState } from "@/context/RunContext";

const CSV_HEADER = [
  "Date",
  "Run",
  "Brand",
  "Flavor",
  "Status",
  "Cases Planned",
  "Cases Made",
  "PPM",
  "Started",
  "Ended",
  "Net Duration",
  "Downtime",
  "Notes",
  "Stoppages",
];

function fmtClock(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function fmtDur(sec: number): string {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function statusOf(r: RunState): string {
  if (r.endedAt != null) return "Finished";
  if (r.isRunning || r.startedAt != null) return "Running";
  return "Upcoming";
}

function buildRow(date: string, run: RunState, index: number): string[] {
  const calc = computeCalc(run, Date.now());
  const planned = run.settings.casesNeeded;
  const casesMade = Math.max(0, planned - calc.casesLeft);
  const stopReasons = (run.stoppages ?? [])
    .map(
      (s) =>
        `${s.reason ?? s.type}(${s.endedAt ? fmtDur((s.endedAt - s.startedAt) / 1000) : "open"})`,
    )
    .join("; ");
  return [
    date,
    runLabel(run, index),
    run.settings.brand,
    run.settings.flavor,
    statusOf(run),
    planned > 0 ? String(planned) : "",
    casesMade > 0 ? String(casesMade) : "",
    calc.ppm > 0 ? String(Math.round(calc.ppm)) : "",
    fmtClock(run.startedAt),
    fmtClock(run.endedAt),
    fmtDur(calc.netElapsedSec),
    fmtDur(calc.totalDowntimeSec) || "0",
    (run.settings.notes ?? "").replace(/"/g, '""'),
    stopReasons,
  ];
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
}

/**
 * Build a CSV for a set of runs and open the native share sheet (or trigger a
 * browser download on web).
 */
export async function exportRunsCsv(
  date: string,
  runs: RunState[],
): Promise<void> {
  const rows: string[][] = [CSV_HEADER];
  runs.forEach((run, i) => rows.push(buildRow(date, run, i)));
  const csv = toCsv(rows);
  const filename = `production-run-${date}.csv`;

  if (Platform.OS === "web") {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/csv",
      dialogTitle: "Export production run CSV",
      UTI: "public.comma-separated-values-text",
    });
  }
}
