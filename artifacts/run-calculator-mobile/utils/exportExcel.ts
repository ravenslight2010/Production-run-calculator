import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import * as XLSX from "xlsx";
import {
  buildQuickBooksCsv,
  buildRunExportRow,
  buildRunWorkbook,
} from "./runExcel";
import { runLabel, type RunState } from "@/context/RunContext";

async function shareNative(
  filename: string,
  bytes: Uint8Array | string,
  mimeType: string,
  uti: string,
): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType,
      dialogTitle: `Export ${filename}`,
      UTI: uti,
    });
  }
}

function downloadWeb(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Build an .xlsx of the given runs and open the share sheet (or download on web). */
export async function exportRunsExcel(
  date: string,
  runs: RunState[],
): Promise<void> {
  const rows = runs.map((r, i) => buildRunExportRow(date, runLabel(r, i), r));
  const wb = buildRunWorkbook(rows);
  const filename = `production-run-${date}.xlsx`;
  const mime =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (Platform.OS === "web") {
    const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadWeb(filename, new Blob([ab], { type: mime }));
    return;
  }
  const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  await shareNative(filename, new Uint8Array(ab), mime, "org.openxmlformats.spreadsheetml.sheet");
}

/** Build a QuickBooks-importable CSV of run totals and share/download it. */
export async function exportRunsQuickBooks(
  date: string,
  runs: RunState[],
): Promise<void> {
  const csv = buildQuickBooksCsv(
    date,
    runs.map((r, i) => ({
      label: runLabel(r, i),
      settings: r.settings,
      actualCases: r.actualCases,
    })),
  );
  const filename = `quickbooks-runs-${date}.csv`;
  if (Platform.OS === "web") {
    downloadWeb(filename, new Blob([csv], { type: "text/csv" }));
    return;
  }
  await shareNative(filename, csv, "text/csv", "public.comma-separated-values-text");
}
