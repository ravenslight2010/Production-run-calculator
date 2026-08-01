import { Platform, Share } from "react-native";
import { computeCalc, runLabel, type RunState } from "@/context/RunContext";

function fmtClock(ms?: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function fmtDur(sec: number): string {
  if (sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function fmtDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusOf(r: RunState): string {
  if (r.endedAt != null) return "Finished";
  if (r.isRunning || r.startedAt != null) return "Running";
  return "Upcoming";
}

/**
 * Build a human-readable shift report (plain text) covering every run, shift
 * totals, and handoff notes. Designed to paste into a text/email/Slack message.
 */
export function buildShiftReport(
  date: string,
  runs: RunState[],
  shiftNotes: string,
): string {
  const now = Date.now();
  const lines: string[] = [];

  lines.push("PRODUCTION SHIFT REPORT");
  lines.push(fmtDate(date));
  lines.push("=".repeat(36));
  lines.push("");

  let totalCases = 0;
  let totalPizzas = 0;
  let totalNetSec = 0;
  let totalDownSec = 0;

  runs.forEach((run, i) => {
    const calc = computeCalc(run, now);
    const planned = run.settings.casesNeeded;
    const casesMade = Math.max(0, planned - calc.casesLeft);
    const pizzasMade = casesMade * run.settings.pizzasPerCase;
    totalCases += casesMade;
    totalPizzas += pizzasMade;
    totalNetSec += calc.netElapsedSec;
    totalDownSec += calc.totalDowntimeSec;

    lines.push(`${i + 1}. ${runLabel(run, i)}  [${statusOf(run)}]`);
    if (run.settings.brand || run.settings.flavor) {
      lines.push(
        `   ${[run.settings.brand, run.settings.flavor].filter(Boolean).join(" — ")}`,
      );
    }
    if (run.settings.dieType) lines.push(`   Die: ${run.settings.dieType}`);
    lines.push(
      `   Cases: ${casesMade}${planned > 0 ? ` / ${planned} planned` : ""}`,
    );
    if (calc.ppm > 0) lines.push(`   PPM: ${Math.round(calc.ppm)}`);
    lines.push(
      `   Time: ${fmtClock(run.startedAt)} → ${fmtClock(run.endedAt)}  (net ${fmtDur(
        calc.netElapsedSec,
      )}, downtime ${fmtDur(calc.totalDowntimeSec)})`,
    );
    const stoppages = run.stoppages ?? [];
    if (stoppages.length > 0) {
      const parts = stoppages.map((s) => {
        const dur = s.endedAt ? fmtDur((s.endedAt - s.startedAt) / 1000) : "open";
        return `${s.reason ?? s.type} (${dur})`;
      });
      lines.push(`   Stoppages: ${parts.join(", ")}`);
    }
    if (run.settings.notes) lines.push(`   Notes: ${run.settings.notes}`);
    lines.push("");
  });

  const shiftPPM =
    totalNetSec > 0 ? Math.round(totalPizzas / (totalNetSec / 60)) : 0;

  lines.push("SHIFT TOTALS");
  lines.push("-".repeat(36));
  lines.push(`Runs:        ${runs.length}`);
  lines.push(`Cases made:  ${totalCases.toLocaleString()}`);
  lines.push(`Pizzas made: ${totalPizzas.toLocaleString()}`);
  lines.push(`Net run:     ${fmtDur(totalNetSec)}`);
  lines.push(`Downtime:    ${fmtDur(totalDownSec)}`);
  lines.push(`Shift PPM:   ${shiftPPM > 0 ? shiftPPM : "—"}`);

  if (shiftNotes.trim()) {
    lines.push("");
    lines.push("SHIFT NOTES");
    lines.push("-".repeat(36));
    lines.push(shiftNotes.trim());
  }

  return lines.join("\n");
}

/**
 * Build the shift report and open the native share sheet (or download a .txt
 * file on web).
 */
export async function shareShiftReport(
  date: string,
  runs: RunState[],
  shiftNotes: string,
): Promise<void> {
  const report = buildShiftReport(date, runs, shiftNotes);

  if (Platform.OS === "web") {
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shift-report-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  await Share.share({
    message: report,
    title: `Shift Report — ${date}`,
  });
}
