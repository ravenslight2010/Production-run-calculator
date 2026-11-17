import { useEffect, useState } from "react";
import { CalendarDays, LoaderCircle, RefreshCw } from "lucide-react";

type PlanningRun = {
  runId: string | null;
  brand: string | null;
  flavor: string | null;
  casesNeeded: number | null;
};

type PlanningDay = {
  date: string;
  status: "scheduled" | "empty" | "unknown";
  runs: PlanningRun[];
};

type PlanningResponse = {
  range: { from: string; through: string; days: number };
  maxDays: number;
  days: PlanningDay[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: PlanningResponse };

const RANGE_STORAGE_KEY = "qc-planning-days-v1";
const RANGE_OPTIONS = [7, 30, 90] as const;
const panelClass = "rounded-xl border border-border/80 bg-card shadow-sm";

function localDateString(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function initialRange(): number {
  try {
    const saved = Number(window.localStorage.getItem(RANGE_STORAGE_KEY));
    return RANGE_OPTIONS.includes(saved as (typeof RANGE_OPTIONS)[number]) ? saved : 30;
  } catch {
    return 30;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parsePlanningResponse(value: unknown): PlanningResponse {
  const root = asRecord(value);
  const range = asRecord(root?.range);
  if (
    !root ||
    !range ||
    typeof range.from !== "string" ||
    typeof range.through !== "string" ||
    typeof range.days !== "number" ||
    typeof root.maxDays !== "number" ||
    !Array.isArray(root.days)
  ) {
    throw new Error("Unexpected QC planning response");
  }

  const days = root.days.map((rawDay): PlanningDay => {
    const day = asRecord(rawDay);
    if (
      !day ||
      typeof day.date !== "string" ||
      !["scheduled", "empty", "unknown"].includes(String(day.status)) ||
      !Array.isArray(day.runs)
    ) {
      throw new Error("Unexpected QC planning day");
    }
    return {
      date: day.date,
      status: day.status as PlanningDay["status"],
      runs: day.runs.map((rawRun) => {
        const run = asRecord(rawRun);
        if (!run) throw new Error("Unexpected QC planning run");
        return {
          runId: nullableText(run.runId),
          brand: nullableText(run.brand),
          flavor: nullableText(run.flavor),
          casesNeeded:
            typeof run.casesNeeded === "number" && Number.isFinite(run.casesNeeded) && run.casesNeeded >= 0
              ? run.casesNeeded
              : null,
        };
      }),
    };
  });
  return {
    range: { from: range.from, through: range.through, days: range.days },
    maxDays: root.maxDays,
    days,
  };
}

function displayDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function unknownValue(value: string | number | null): string {
  if (value === null) return "Unknown";
  return typeof value === "number" ? `${new Intl.NumberFormat().format(value)} cases` : value;
}

export default function QcPlanningView() {
  const [days, setDays] = useState(initialRange);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    const today = localDateString();
    void fetch(`/api/qc/planning?today=${encodeURIComponent(today)}&days=${days}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("QC planning request failed");
        return parsePlanningResponse(await response.json());
      })
      .then((data) => setLoadState({ status: "ready", data }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadState({ status: "error" });
      });
    return () => controller.abort();
  }, [days, refreshKey]);

  const selectRange = (value: string) => {
    const next = Number(value);
    if (!RANGE_OPTIONS.includes(next as (typeof RANGE_OPTIONS)[number])) return;
    setDays(next);
    try {
      window.localStorage.setItem(RANGE_STORAGE_KEY, String(next));
    } catch {
      // The selected range still works for this visit when storage is unavailable.
    }
  };

  return (
    <section
      className={`${panelClass} mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-5`}
      aria-labelledby="qc-planning-title"
      data-testid="qc-planning-view"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Read-only schedule
          </div>
          <h2 id="qc-planning-title" className="mt-1 text-xl font-semibold">Upcoming production</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Scheduled production only. This view does not edit runs or verify product references.
          </p>
        </div>
        <div className="flex flex-col gap-2 xs:flex-row sm:items-end">
          <label className="min-w-0 text-xs font-medium text-muted-foreground">
            Date range
            <select
              className="mt-1 min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              style={{ colorScheme: "dark" }}
              value={days}
              onChange={(event) => selectRange(event.currentTarget.value)}
              data-testid="select-qc-planning-range"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option} value={option}>Next {option} days</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loadState.status === "loading"}
            data-testid="button-refresh-qc-planning"
          >
            {loadState.status === "loading"
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </button>
        </div>
      </header>

      {loadState.status === "loading" && (
        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-4 text-sm" role="status">
          Loading the saved production schedule…
        </p>
      )}

      {loadState.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-4" role="alert" data-testid="alert-qc-planning-error">
          <p className="text-sm font-semibold">Upcoming production could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection or QC access, then refresh.</p>
        </div>
      )}

      {loadState.status === "ready" && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="text-qc-planning-range">
            {displayDate(loadState.data.range.from)} through {displayDate(loadState.data.range.through)}
            {" · "}maximum {loadState.data.maxDays} days
          </p>
          {loadState.data.days.length === 0 && (
            <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-4 text-sm" role="status" data-testid="empty-qc-planning">
              No persisted schedule days were found in this range.
            </p>
          )}
          {loadState.data.days.length > 0 &&
            loadState.data.days.every((day) => day.status === "empty") && (
              <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-4 text-sm" role="status" data-testid="empty-qc-planning">
                No scheduled production was found in this range.
              </p>
            )}
          <div className="space-y-3">
            {loadState.data.days.map((day) => (
              <article
                key={day.date}
                className="min-w-0 rounded-xl border border-border/70 p-3 sm:p-4"
                data-testid={`qc-planning-day-${day.date}`}
              >
                <h3 className="font-semibold">{displayDate(day.date)}</h3>
                {day.status === "unknown" ? (
                  <p className="mt-2 text-sm text-muted-foreground">Schedule details are unknown.</p>
                ) : day.status === "empty" ? (
                  <p className="mt-2 text-sm text-muted-foreground">No runs scheduled for this date.</p>
                ) : (
                  <ul className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {day.runs.map((run, index) => (
                      <li
                        key={`${run.runId ?? "unknown"}-${index}`}
                        className="min-w-0 rounded-lg bg-muted/35 p-3"
                        data-testid={`qc-planning-run-${run.runId ?? `${day.date}-${index}`}`}
                      >
                        <p className="break-words font-semibold">
                          {unknownValue(run.brand)} <span aria-hidden="true">·</span> {unknownValue(run.flavor)}
                        </p>
                        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Run ID</dt>
                          <dd className="min-w-0 break-all font-mono">{unknownValue(run.runId)}</dd>
                          <dt className="text-muted-foreground">Case demand</dt>
                          <dd>{unknownValue(run.casesNeeded)}</dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
