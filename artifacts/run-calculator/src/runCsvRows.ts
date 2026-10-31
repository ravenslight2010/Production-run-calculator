import { DEFAULT_VALUES, type FormValues, type HistoryDay, type RunMeta } from "./types";

const RUN_COLUMNS = [
  "Date", "Brand", "Flavor", "Status", "Cases Planned", "Cases Actual",
  "Waste Lbs", "Started", "Ended", "Duration", "Downtime", "Actual PPM",
  "Notes", "Stoppages",
];

type RowBuilder = (date: string, run: RunMeta, values: FormValues) => string[];

/** Current-day operational rows are not immutable canonical completion records. */
export function currentRunCsvRows(
  date: string,
  runs: RunMeta[],
  valuesFor: (run: RunMeta) => FormValues,
  buildRow: RowBuilder,
): string[][] {
  return [[...RUN_COLUMNS], ...runs.map((run) => buildRow(date, run, valuesFor(run)))];
}

/** Keep provenance and its header together; pending rows are never canonical. */
export function historyRunCsvRows(day: HistoryDay, buildRow: RowBuilder): string[][] {
  return [
    [...RUN_COLUMNS, "Record source"],
    ...day.runs.map((run) => [
      ...buildRow(day.date, run, (day.runValues[run.id] ?? DEFAULT_VALUES) as FormValues),
      day.pendingRunIds?.includes(run.id)
        ? "Pending local completion — not server-acknowledged"
        : "Canonical server completion — view/export only",
    ]),
  ];
}
