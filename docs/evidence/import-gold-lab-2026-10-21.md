# Import Gold Lab evidence note

Import Gold is an opt-in evaluation aid, not an import source of truth. Expected values are taken only from the server's authoritative snapshot after a human-reviewed Apply succeeds. Provider predictions are stored as score attempts and never feed back into Apply, recipes, profiles, inventory, or production routes.

The feature is off by default. Enabling it requires all of these explicit server settings:

- `IMPORT_GOLD_ENABLED=true`
- `IMPORT_GOLD_SOURCE_USE_APPROVED=true`
- `IMPORT_GOLD_RETENTION_APPROVED=true`
- `IMPORT_GOLD_APPROVAL_RECORD_REF` set to a non-empty, single-line reference (up to 500 characters) to the completed approval record in its approved restricted location
- `IMPORT_GOLD_PRIVACY_REVIEW_STATUS=approved` or `IMPORT_GOLD_PRIVACY_REVIEW_STATUS=not_required`

The approval flags are operator attestations, not proof by themselves. Before setting them, create and retain a reviewable record containing:

- A stable record ID/reference, the source owner and their role or organization, and the approval date.
- The source/workbook scope covered and an explicit statement that its content may be used for Import Gold evaluation.
- The approved retention period or deletion deadline, the person responsible for deletion, and the permitted deletion method.
- The privacy review outcome (`approved` or `not_required`), reviewer, date, and any conditions. If review is still pending or is required but not approved, leave the lab disabled.
- The approver's evidence of authorization, stored in the approved restricted location (do not copy customer workbook content into this repository or environment-variable values).

Use this blank record structure in the approved restricted location; do not fill it in or commit completed approval evidence here:

```text
Record reference:
Status: pending / approved / rejected
Source owner and role/organization:
Approval date:
Source/workbook scope:
Permitted Import Gold evaluation use:
Authorization evidence location:
Retention period or deletion deadline:
Retention terms approved by source owner:
Deletion owner and permitted method:
Privacy review status: approved / not_required / pending / rejected
Privacy reviewer and review date:
Privacy conditions or limitations:
```

The recorded retention terms must be compatible with current behavior: cases and scores stay until a manager permanently deletes them, survive ordinary daily reset and factory purge, and are not automatically deleted on export. Do not enable the lab if the source owner's terms require automatic expiration or another retention behavior this system does not provide. The manager review checkbox repeats these conditions but does not grant authorization.

The server checks that the approval reference is present and that the privacy review status is explicitly approved or not required before enabling capture, case management, export, or scoring. It does not fetch or validate the referenced record; the operator must verify that the record exists, is current, covers the intended source, and is stored with appropriate access controls before setting the approval flags.

Cases remain stored until a manager permanently deletes them. Exclusion only removes a case from scoring and JSONL export; it does not delete data. Cases and scores are isolated by current scope and intentionally survive ordinary daily reset and factory purge. Authorized managers must export or delete cases according to the retention authorization. No automatic purge is implied by export.

The local OpenAI-compatible scorer is optional and score-only; provider availability is not part of `/api/readyz`. Gemini comparison is also an explicit manager action when credentials are configured. Any proposal to route live imports through a provider or promote a model requires a separate owner decision and independent evaluation evidence.

Implementation and automated tests use synthetic fixtures only. Integration tests use a test-only approval reference and `not_required` privacy status; they do not represent or grant customer approval. No real customer workbook was collected, captured, or sent to a provider for this change.
