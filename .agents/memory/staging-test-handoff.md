---
name: Dedicated staging test environment
description: Owner-created safe testing environment and stale isolated-task handoff caution.
---

The owner created a dedicated place for agent testing: an approved isolated local
app/database sandbox, not a separately published staging URL.
Use it rather than asking the owner to create another test area or assuming
production's disabled demo login is the only option.

**Why:** An isolated task copy can predate merged staging setup. Absence from its
files, workflows or configuration does not establish that staging is unavailable.

**How to apply:** Retrieve the current staging handoff where available. If this
copy lacks it, first try refreshing the merged source when the owner requests
it. A task's saved backup can refer to its own isolated tree rather than the
main workspace; check the fetched tree instead of assuming that a successful
fetch updated it. If no available source contains the handoff, identify the
missing source-sync boundary rather than repeatedly asking whether staging
exists. Never request credentials in chat. Verify isolation and build identity;
do not label staging results as production behavior.

When the owner synchronizes merged source to the existing GitHub backup branch,
fetch and integrate it while preserving task evidence; no app publication is
needed for that source refresh.

**Why:** A source handoff, not another test account or staging address, resolved
the missing-setup boundary for the stale task copy.

Owner-approved staging-only completion must retain the explicit statement that
published-site behavior is unverified. It does not establish production
readiness or satisfy release gates requiring production evidence.

**Why:** The owner explicitly confirmed this completion boundary rather than
authorizing production mutations or treating local testing as published proof.

**How to apply:** Carry this limitation into completion summaries and evidence;
leave production-specific results unverified until independently established.
