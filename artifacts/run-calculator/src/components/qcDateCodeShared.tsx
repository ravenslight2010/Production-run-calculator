import type { QcDateCodeCheckInput, QcDateCodeReadability, QcDateCodeText, QcEvent } from "@workspace/api-client-react";

export type DateCodeField = keyof QcDateCodeText;
export type Readability = QcDateCodeReadability[DateCodeField];

export const DATE_CODE_FIELDS: Array<{ key: DateCodeField; label: string }> = [
  { key: "productionCode", label: "Production code" },
  { key: "bestByCode", label: "Best-by code" },
  { key: "otherCode", label: "Other approved code" },
];

export const DATE_CODE_CONTEXTS: Array<{ value: QcDateCodeCheckInput["context"]; label: string }> = [
  { value: "shipper-case", label: "Shipper case" },
  { value: "carton-label", label: "Carton label" },
  { value: "product-pack", label: "Product pack" },
];

export const READABILITY: Array<{ value: Readability; label: string }> = [
  { value: "readable", label: "Readable" },
  { value: "missing", label: "Missing" },
  { value: "unreadable", label: "Unreadable" },
  { value: "ambiguous", label: "Ambiguous" },
];

export const EMPTY_TEXT: QcDateCodeText = { productionCode: "", bestByCode: "", otherCode: "" };
export const DEFAULT_READABILITY: QcDateCodeReadability = { productionCode: "readable", bestByCode: "readable", otherCode: "readable" };

export const MAX_CODE = 200;

/** Literal comparison prep only: NFC + boundary trim. No date parsing. */
export function literal(value: string) {
  return value.normalize("NFC").trim();
}

export function contextLabel(value: unknown) {
  return DATE_CODE_CONTEXTS.find((c) => c.value === value)?.label ?? "Unknown context";
}

export function shown(value: unknown) {
  if (typeof value !== "string") return "Not recorded";
  if (value === "[redacted]") return "Redacted";
  return value === "" ? "Blank" : value;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function ResultTag({ value }: { value: string }) {
  const style = value === "pass"
    ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200"
    : value === "fail"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200"
      : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style}`}>{value}</span>;
}

export function QcDateCodeComparison({ event }: { event: QcEvent }) {
  const payload = obj(event.payload);
  const results = obj(payload.fieldResults);
  const observed = obj(payload.observed);
  const readability = obj(payload.readability);
  const snapshot = payload.referenceSnapshot && typeof payload.referenceSnapshot === "object" ? obj(payload.referenceSnapshot) : null;
  const outcome = typeof payload.outcome === "string" ? payload.outcome : "not-evaluated";
  const reason = typeof payload.referenceUnavailableReason === "string" ? payload.referenceUnavailableReason : "";

  return (
    <section className="rounded-lg border border-border/70 bg-background p-3" data-testid={`qc-date-code-result-${event.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold">Printed code record · {contextLabel(payload.context)}</p>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
            Batch/pack context: <span className="font-mono">{shown(payload.batchContext)}</span>
          </p>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground" data-testid={`text-date-code-source-${event.id}`}>
            {snapshot
              ? `Reference snapshot: ${shown(snapshot.sourceIdentity)} · source version ${shown(snapshot.sourceVersion)} · config v${String(snapshot.version ?? "?")} · ${String(snapshot.state ?? "unknown state")}`
              : "Observation only · no approved reference applied"}
          </p>
        </div>
        <ResultTag value={outcome} />
      </div>
      {reason && <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">{reason}</p>}
      <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
        {DATE_CODE_FIELDS.map(({ key, label }) => {
          const item = obj(results[key]);
          return (
            <div key={key} className="min-w-0 rounded-md border border-border/60 p-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words text-xs"><span className="font-semibold">Observed:</span> <span className="font-mono">{shown(item.observed ?? observed[key])}</span></dd>
              <dd className="mt-0.5 text-[11px] text-muted-foreground">Readability: {shown(item.readability ?? readability[key])}</dd>
              <dd className="mt-1 break-words text-xs"><span className="font-semibold">Expected:</span> <span className="font-mono">{item.expected === null ? "No approved applicable text" : shown(item.expected)}</span></dd>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                <ResultTag value={typeof item.state === "string" ? item.state : "not-evaluated"} />
                {typeof item.reason === "string" && item.reason && <span className="min-w-0 break-words text-[10px] text-muted-foreground">{item.reason}</span>}
              </div>
            </div>
          );
        })}
      </dl>
      {typeof payload.note === "string" && payload.note && (
        <p className="mt-2 break-words text-xs text-muted-foreground"><span className="font-semibold">Note:</span> {shown(payload.note)}</p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Literal text comparison only. No calendar, shelf-life, or decoding check was made, and this record is not a hold or release decision.
      </p>
    </section>
  );
}
