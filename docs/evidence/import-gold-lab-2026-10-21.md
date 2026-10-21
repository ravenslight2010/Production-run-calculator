# Import Gold Lab evidence note

Import Gold is an opt-in evaluation aid, not an import source of truth. Expected values are taken only from the server's authoritative snapshot after a human-reviewed Apply succeeds. Provider predictions are stored as score attempts and never feed back into Apply, recipes, profiles, inventory, or production routes.

The feature is off by default. Enabling it requires all three explicit server settings: `IMPORT_GOLD_ENABLED=true`, `IMPORT_GOLD_SOURCE_USE_APPROVED=true`, and `IMPORT_GOLD_RETENTION_APPROVED=true`. The latter two are operator attestations: obtain and record the source owner's authorization for evaluation use and retention, plus any required privacy review, before collecting any real customer workbook material. The manager review checkbox repeats this condition but is not a substitute for authorization.

Cases remain stored until a manager permanently deletes them. Exclusion only removes a case from scoring and JSONL export; it does not delete data. Cases and scores are isolated by current scope and intentionally survive ordinary daily reset and factory purge. Authorized managers must export or delete cases according to the retention authorization. No automatic purge is implied by export.

The local OpenAI-compatible scorer is optional and score-only; provider availability is not part of `/api/readyz`. Gemini comparison is also an explicit manager action when credentials are configured. Any proposal to route live imports through a provider or promote a model requires a separate owner decision and independent evaluation evidence.

Implementation and automated tests use synthetic fixtures only. No real customer workbook was captured or sent to a provider for this change.
