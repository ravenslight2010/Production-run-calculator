---
name: Calculator module boundaries
description: The eventual calculator split follows operational departments, not arbitrary file size or current navigation tabs.
---

When the large calculator surface is eventually split, organize it around four collaborating operational domains: **production line**, **warehouse and inventory**, **QC department**, and **management tools**. They are modules within one application, not separate apps or isolated data silos.

**Why:** These are the user's real workflows and ownership boundaries, so they provide a more durable architecture than splitting purely by component size or current tab labels. Each department depends on data produced or updated by the others.

**How to apply:** Keep shared live-run state, sync, auth, navigation, master-data access, event/update contracts, and common calculation primitives in explicit shared modules. Department modules must read and write through those shared contracts so production changes flow into warehouse needs, QC sees the same run state, and management sees consistent operational data. Use lazy loading only as a loading optimization, never as a state boundary. Preserve web/mobile parity and existing operational behavior while moving code.