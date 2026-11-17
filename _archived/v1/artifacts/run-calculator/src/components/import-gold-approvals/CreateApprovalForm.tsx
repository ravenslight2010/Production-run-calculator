import { useState } from "react";
import type { ImportGoldApprovalInput } from "@workspace/api-client-react";
import { EMPTY_FORM, Field, MetadataList, REF_FIELDS, btn, inputClass, validate, type FormState } from "./shared";

export default function CreateApprovalForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: ImportGoldApprovalInput) => Promise<boolean> }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const shown = touched ? errors : {};
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setReviewing(false);
  };
  const aria = (k: keyof FormState) => ({
    "aria-invalid": shown[k] ? true : undefined,
    "aria-describedby": shown[k] ? `gold-${k}-error` : undefined,
  });

  const build = (): ImportGoldApprovalInput => ({
    recordRef: form.recordRef.trim(),
    sourceDigest: form.sourceDigest.trim(),
    importType: form.importType,
    purpose: "local_spec_import_accuracy",
    ownerRef: form.ownerRef.trim(),
    ownerApprovedAt: new Date(form.ownerApprovedAt).toISOString(),
    privacyStatus: form.privacyStatus,
    privacyReviewerRef: form.privacyReviewerRef.trim(),
    privacyReviewedAt: new Date(form.privacyReviewedAt).toISOString(),
    conditionsRef: form.conditionsRef.trim(),
    externalCopiesRef: form.externalCopiesRef.trim(),
    backupHandlingRef: form.backupHandlingRef.trim(),
    manualDeletionAccepted: true,
    retentionDays: 30,
    conditionsSatisfied: true,
    validUntil: new Date(form.validUntil).toISOString(),
  });

  return (
    <div role="group" aria-labelledby="gold-approval-form-heading" className="mt-3 rounded-md border border-border p-3" data-testid="gold-approval-form">
      <h3 id="gold-approval-form-heading" className="text-sm font-semibold">
        New approval metadata (immutable once recorded)
      </h3>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {REF_FIELDS.map(([key, label]) => (
          <Field key={key} id={`gold-${key}`} label={label} error={shown[key]}>
            <input
              id={`gold-${key}`}
              className={inputClass}
              value={form[key]}
              maxLength={128}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set(key, e.target.value)}
              data-testid={`input-gold-${key}`}
              {...aria(key)}
            />
          </Field>
        ))}
        <div className="md:col-span-2">
          <Field
            id="gold-sourceDigest"
            label="Evaluation input digest (SHA-256)"
            hint="64 lowercase hex characters: SHA-256 of evaluation input JSON with recursively sorted object keys and original array order. Not a workbook-file hash or approval evidence."
            error={shown.sourceDigest}
          >
            <input
              id="gold-sourceDigest"
              className={inputClass}
              value={form.sourceDigest}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set("sourceDigest", e.target.value)}
              data-testid="input-gold-sourceDigest"
              {...aria("sourceDigest")}
            />
          </Field>
        </div>
        <Field id="gold-importType" label="Import type">
          <select id="gold-importType" className={inputClass} value={form.importType} onChange={(e) => set("importType", e.target.value as FormState["importType"])} data-testid="select-gold-importType">
            <option value="spec">Spec</option>
            <option value="premix">Premix</option>
            <option value="cheese">Cheese</option>
          </select>
        </Field>
        <Field id="gold-privacyStatus" label="Privacy status">
          <select id="gold-privacyStatus" className={inputClass} value={form.privacyStatus} onChange={(e) => set("privacyStatus", e.target.value as FormState["privacyStatus"])} data-testid="select-gold-privacyStatus">
            <option value="approved">Approved</option>
            <option value="not_required">Not required</option>
          </select>
        </Field>
        {(
          [
            ["ownerApprovedAt", "Owner approved at (past)"],
            ["privacyReviewedAt", "Privacy reviewed at (past)"],
            ["validUntil", "Valid until (future)"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} id={`gold-${key}`} label={label} error={shown[key]}>
            <input
              id={`gold-${key}`}
              type="datetime-local"
              className={inputClass}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              data-testid={`input-gold-${key}`}
              {...aria(key)}
            />
          </Field>
        ))}
        <div className="text-sm">
          <span className="font-medium">Purpose</span>
          <p className="mt-1 font-mono text-xs break-all">local_spec_import_accuracy</p>
          <span className="mt-2 block font-medium">Retention</span>
          <p className="mt-1 text-xs">30 days</p>
        </div>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.manualDeletionAccepted} onChange={(e) => set("manualDeletionAccepted", e.target.checked)} data-testid="checkbox-gold-manualDeletionAccepted" />
          <span>
            I accept manual deletion of cases, scores and evaluation working copies within 30 days, or earlier on owner
            request. Backups follow the separate backup handling reference.
          </span>
        </label>
        {shown.manualDeletionAccepted && <p className="text-xs text-destructive">{shown.manualDeletionAccepted}</p>}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.conditionsSatisfied} onChange={(e) => set("conditionsSatisfied", e.target.checked)} data-testid="checkbox-gold-conditionsSatisfied" />
          <span>The documented conditions are satisfied.</span>
        </label>
        {shown.conditionsSatisfied && <p className="text-xs text-destructive">{shown.conditionsSatisfied}</p>}
      </div>

      {!reviewing ? (
        <button
          type="button"
          className={`${btn} mt-3 border-border`}
          disabled={busy}
          onClick={() => {
            setTouched(true);
            if (valid) setReviewing(true);
          }}
          data-testid="button-review-gold-approval"
        >
          Review before recording
        </button>
      ) : (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3" data-testid="gold-approval-review">
          <p className="text-sm font-medium">Check every field. Recorded metadata cannot be edited.</p>
          <MetadataList approval={{ ...build() }} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btn} border-primary bg-primary text-primary-foreground`}
              disabled={busy || !valid}
              onClick={async () => {
                if (!valid) return;
                const ok = await onSubmit(build());
                if (ok) setForm(EMPTY_FORM);
              }}
              data-testid="button-submit-gold-approval"
            >
              {busy ? "Recording..." : "Record pending approval"}
            </button>
            <button type="button" className={`${btn} border-border`} disabled={busy} onClick={() => setReviewing(false)} data-testid="button-edit-gold-approval">
              Back to edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
