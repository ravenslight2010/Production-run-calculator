---
name: V1 data recovery boundary
description: Owner decision about the removed V1 production database and safe V2 data reconstruction.
---

Do not assume the removed V1 production database can be safely recovered. V2 work must not rely on restoring that database unless a separately verified backup is found and the owner changes this decision.

**Why:** The owner stated there will not be a safe recovery, and repository checks did not locate a complete V1 data export.

**How to apply:** Treat V1 runs, audit history, staff credentials, and inventory balances/movements as unavailable. Rebuild only setup records supported by explicitly approved surviving source files, create fresh V2 staff accounts, and use a fresh physical inventory count.
