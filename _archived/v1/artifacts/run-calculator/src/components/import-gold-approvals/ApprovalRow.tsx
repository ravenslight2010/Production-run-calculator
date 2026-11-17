import { useState } from "react";
import type { ImportGoldApproval } from "@workspace/api-client-react";
import { MetadataList, STATUS_CLASS, STATUS_LABEL, approvalStatus, btn, fmt } from "./shared";

export default function ApprovalRow({
  approval,
  busy,
  onVerify,
  onRevoke,
}: {
  approval: ImportGoldApproval;
  busy: boolean;
  onVerify: () => Promise<boolean>;
  onRevoke: () => Promise<boolean>;
}) {
  const status = approvalStatus(approval);
  const [open, setOpen] = useState(false);
  const [attest, setAttest] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  return (
    <li className="rounded-md border border-border p-3" data-testid={`gold-approval-${approval.id}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Approval #{approval.id}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`} data-testid={`gold-approval-status-${approval.id}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs break-all">{approval.recordRef}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Created by {approval.createdBy} · {fmt(approval.createdAt)} · valid until {fmt(approval.validUntil)}
          </p>
          {approval.verifiedAt && (
            <p className="mt-1 text-xs text-muted-foreground">Verified by {approval.verifiedBy ?? "authorized reviewer"} · {fmt(approval.verifiedAt)}</p>
          )}
          {approval.revokedAt && (
            <p className="mt-1 text-xs text-destructive">Revoked by {approval.revokedBy ?? "authorized reviewer"} · {fmt(approval.revokedAt)}</p>
          )}
        </div>
        <button type="button" className={`${btn} shrink-0 border-border`} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid={`button-toggle-gold-approval-${approval.id}`}>
          {open ? "Hide details" : "Review all fields"}
        </button>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground break-all">Facility scope: {approval.scope}</p>
          <MetadataList approval={approval} />
          {status === "pending" && (
            <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={attest} onChange={(e) => setAttest(e.target.checked)} data-testid={`checkbox-gold-attest-${approval.id}`} />
                <span>
                  I privately reviewed the referenced owner approval, privacy review and conditions, and every field above
                  matches. This records my name and the server time. It does not enable capture or grant Gemini or export
                  permission.
                </span>
              </label>
              <button
                type="button"
                className={`${btn} mt-2 border-primary bg-primary text-primary-foreground`}
                disabled={busy || !attest}
                onClick={async () => {
                  if (await onVerify()) setAttest(false);
                }}
                data-testid={`button-verify-gold-approval-${approval.id}`}
              >
                Record verification
              </button>
            </div>
          )}
          {status !== "revoked" && (
            <div className="mt-3">
              {!confirmRevoke ? (
                <button type="button" className={`${btn} border-destructive/40 text-destructive`} disabled={busy} onClick={() => setConfirmRevoke(true)} data-testid={`button-revoke-gold-approval-${approval.id}`}>
                  Revoke approval
                </button>
              ) : (
                <div role="alertdialog" aria-label={`Confirm revoking approval ${approval.id}`} className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p>Revocation is permanent. Metadata and audit stay; future captures cannot use this approval.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${btn} border-destructive bg-destructive text-destructive-foreground`}
                      disabled={busy}
                      onClick={async () => {
                        if (await onRevoke()) setConfirmRevoke(false);
                      }}
                      data-testid={`button-confirm-revoke-gold-approval-${approval.id}`}
                    >
                      Confirm revoke
                    </button>
                    <button type="button" className={`${btn} border-border`} disabled={busy} onClick={() => setConfirmRevoke(false)} data-testid={`button-cancel-revoke-gold-approval-${approval.id}`}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
