import type { KeyboardEvent, ReactNode } from "react";
import type { ImportGoldApproval, ImportGoldApprovalInput } from "@workspace/api-client-react";


// Metadata-only approval register. It never uploads, stores, or links private
// evidence, never enables capture, and grants no Gemini or export permission.

export const OPAQUE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
export const EVALUATION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const POLL_MS = 30_000;

// Generated TypeScript types do not validate an HTTP response at runtime.
export function checkedApproval(value: unknown): ImportGoldApproval {
  if (!value || typeof value !== "object") throw new Error("Invalid approval response");
  const row = value as Record<string, unknown>;
  const refs = ["recordRef", "ownerRef", "privacyReviewerRef", "conditionsRef", "externalCopiesRef", "backupHandlingRef"];
  const instant = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 ||
      typeof row.scope !== "string" || typeof row.createdBy !== "string" ||
      !refs.every((key) => typeof row[key] === "string" && OPAQUE_REF_PATTERN.test(row[key])) ||
      typeof row.sourceDigest !== "string" || !EVALUATION_DIGEST_PATTERN.test(row.sourceDigest) ||
      !["spec", "premix", "cheese"].includes(String(row.importType)) ||
      row.purpose !== "local_spec_import_accuracy" ||
      !["approved", "not_required"].includes(String(row.privacyStatus)) ||
      row.retentionDays !== 30 || row.manualDeletionAccepted !== true || row.conditionsSatisfied !== true ||
      !["ownerApprovedAt", "privacyReviewedAt", "validUntil", "createdAt"].every((key) => instant(row[key])) ||
      !["verifiedAt", "revokedAt"].every((key) => row[key] === null || instant(row[key])) ||
      !["verifiedBy", "revokedBy"].every((key) => row[key] === null || typeof row[key] === "string")) {
    throw new Error("Invalid approval response");
  }
  return value as ImportGoldApproval;
}

export function checkedApprovalPage(value: unknown): { approvals: ImportGoldApproval[]; nextBefore: number | null } {
  if (!value || typeof value !== "object") throw new Error("Invalid approval list");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.approvals) ||
      !(page.nextBefore === null || (Number.isSafeInteger(page.nextBefore) && Number(page.nextBefore) > 0))) {
    throw new Error("Invalid approval list");
  }
  return { approvals: page.approvals.map(checkedApproval), nextBefore: page.nextBefore as number | null };
}

export type ApprovalStatus = "pending" | "verified" | "expired" | "revoked";

export function approvalStatus(approval: ImportGoldApproval, now = Date.now()): ApprovalStatus {
  if (approval.revokedAt) return "revoked";
  if (new Date(approval.validUntil).getTime() <= now) return "expired";
  if (approval.verifiedAt) return "verified";
  return "pending";
}

export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending verification",
  verified: "Verified",
  expired: "Expired",
  revoked: "Revoked",
};

export const STATUS_CLASS: Record<ApprovalStatus, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  verified: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  expired: "border-border bg-muted text-muted-foreground",
  revoked: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function errorStatus(cause: unknown): number | null {
  if (cause && typeof cause === "object" && "status" in cause) {
    const s = (cause as { status: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

export function safeMessage(cause: unknown, action: string): string {
  const status = errorStatus(cause);
  if (status === 401) return `Your session ended. Sign in again, then ${action}.`;
  if (status === 403)
    return "Access denied. This requires a current Manager or QC Manager role with manage-staff or manage-qc capability.";
  if (status === 404) return "That approval is no longer in this scope. Refresh the list and try again.";
  if (status === 409)
    return "The approval changed or no longer allows this action (it may be expired, revoked, or already reviewed). Refresh and review again.";
  if (status === 400 || status === 422)
    return "The server rejected the metadata. Check each reference, the evaluation digest, and the dates, then submit again.";
  if (status === 429) return "Too many requests. Wait a moment, then try again.";
  if (status !== null && status >= 500) return `The server could not ${action} right now. Try again shortly.`;
  return `Could not ${action}. Check your connection and try again.`;
}

export const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export type FormState = {
  recordRef: string;
  sourceDigest: string;
  importType: ImportGoldApprovalInput["importType"];
  ownerRef: string;
  ownerApprovedAt: string;
  privacyStatus: ImportGoldApprovalInput["privacyStatus"];
  privacyReviewerRef: string;
  privacyReviewedAt: string;
  conditionsRef: string;
  externalCopiesRef: string;
  backupHandlingRef: string;
  validUntil: string;
  manualDeletionAccepted: boolean;
  conditionsSatisfied: boolean;
};

export const EMPTY_FORM: FormState = {
  recordRef: "",
  sourceDigest: "",
  importType: "spec",
  ownerRef: "",
  ownerApprovedAt: "",
  privacyStatus: "approved",
  privacyReviewerRef: "",
  privacyReviewedAt: "",
  conditionsRef: "",
  externalCopiesRef: "",
  backupHandlingRef: "",
  validUntil: "",
  manualDeletionAccepted: false,
  conditionsSatisfied: false,
};

export const REF_FIELDS = [
  ["recordRef", "Record reference"],
  ["ownerRef", "Owner reference"],
  ["privacyReviewerRef", "Privacy reviewer reference"],
  ["conditionsRef", "Conditions reference"],
  ["externalCopiesRef", "External copies reference"],
  ["backupHandlingRef", "Backup handling reference"],
] as const;

export type Errors = Partial<Record<keyof FormState, string>>;

export function validate(form: FormState, now = Date.now()): Errors {
  const errors: Errors = {};
  for (const [key, label] of REF_FIELDS) {
    if (!OPAQUE_REF_PATTERN.test(form[key].trim()))
      errors[key] = `${label} must be an opaque ID: start with a letter or digit, then up to 127 letters, digits, colon, underscore or hyphen. No URLs, names, paths or emails.`;
  }
  if (!EVALUATION_DIGEST_PATTERN.test(form.sourceDigest.trim()))
    errors.sourceDigest = "Enter exactly 64 lowercase hex characters: the SHA-256 of the evaluation input JSON (not the workbook file hash).";
  const past = (v: string) => v !== "" && !Number.isNaN(new Date(v).getTime()) && new Date(v).getTime() <= now;
  if (!past(form.ownerApprovedAt)) errors.ownerApprovedAt = "Owner approval must be a completed date and time in the past.";
  if (!past(form.privacyReviewedAt)) errors.privacyReviewedAt = "Privacy review must be a completed date and time in the past.";
  const until = new Date(form.validUntil).getTime();
  if (!form.validUntil || Number.isNaN(until) || until <= now) errors.validUntil = "Valid until must be in the future.";
  if (!form.manualDeletionAccepted) errors.manualDeletionAccepted = "Confirm manual deletion responsibility.";
  if (!form.conditionsSatisfied) errors.conditionsSatisfied = "Confirm the documented conditions are satisfied.";
  return errors;
}

// Swallow Enter so the embedded card never submits the surrounding Home form.
export const blockEnter = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Enter" && ["INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)) {
    event.preventDefault();
    event.stopPropagation();
  }
};

export const inputClass =
  "mt-1 block w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono break-all focus:outline-none focus:ring-2 focus:ring-ring";
export const btn =
  "min-h-11 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-labelledby="import-gold-approvals-heading"
      data-testid="import-gold-approvals"
      onKeyDown={blockEnter}
    >
      <h2 id="import-gold-approvals-heading" className="font-semibold">
        Gold Lab approvals
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Metadata-only register. Enter opaque reference IDs only, never approval documents, customer workbooks,
        names, emails, URLs or source locations. Private evidence is reviewed outside this app.
      </p>
      {children}
    </section>
  );
}

export function Skeleton() {
  return (
    <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading approvals" data-testid="gold-approvals-loading">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  );
}

export function Explainer() {
  return (
    <ul className="mt-2 list-disc space-y-1 rounded-md bg-muted/40 p-3 pl-6 text-xs text-muted-foreground" data-testid="gold-approvals-explainer">
      <li>Review the referenced owner approval, privacy review and conditions privately, outside this app.</li>
      <li>
        Delete cases, scores and evaluation working copies manually within 30 days, or earlier if the owner asks.
        Backups are handled separately under the documented backup reference.
      </li>
      <li>
        This metadata does not replace the evidence, does not grant Gemini or export permission, and does not enable
        capture.
      </li>
    </ul>
  );
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export type Displayable = Omit<ImportGoldApprovalInput, never>;

export function MetadataList({ approval }: { approval: Displayable }) {
  const rows: [string, string][] = [
    ["Record", approval.recordRef],
    ["Evaluation digest", approval.sourceDigest],
    ["Import type", approval.importType],
    ["Purpose", approval.purpose],
    ["Owner", approval.ownerRef],
    ["Owner approved", fmt(approval.ownerApprovedAt)],
    ["Privacy status", approval.privacyStatus === "not_required" ? "Not required" : "Approved"],
    ["Privacy reviewer", approval.privacyReviewerRef],
    ["Privacy reviewed", fmt(approval.privacyReviewedAt)],
    ["Conditions", approval.conditionsRef],
    ["External copies", approval.externalCopiesRef],
    ["Backup handling", approval.backupHandlingRef],
    ["Retention", `${approval.retentionDays} days, manual deletion accepted: ${approval.manualDeletionAccepted ? "yes" : "no"}`],
    ["Conditions satisfied", approval.conditionsSatisfied ? "yes" : "no"],
    ["Valid until", fmt(approval.validUntil)],
  ];
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
