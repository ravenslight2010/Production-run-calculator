---
name: Database capacity evidence
description: Interpret app-owned PostgreSQL capacity samples without overstating provider or Autoscale headroom.
---

Treat PostgreSQL client-backend counts separately from application pool connections. A remaining-slot estimate is conservative PostgreSQL evidence, not proof of the hosting provider's usable quota or worst-case Autoscale capacity.

**Why:** Proxies can multiplex application connections onto fewer database backends, and provider reserves or connection policies can impose limits not represented in PostgreSQL settings.

**How to apply:** Use the application's own connection, identify whether it reaches a recovery replica, label unavailable readings explicitly, and keep provider reserves and Autoscale instance counts unknown unless independently measured. Never infer instance count from hostnames, process IDs, or pool/backend counts. Retain only bounded counts and build identity, not connection strings, role names, query text, or operational rows.
