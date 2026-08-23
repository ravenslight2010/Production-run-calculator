---
name: Calculator module boundaries
description: The eventual calculator split follows operational departments, not arbitrary file size or current navigation tabs.
---

When the large calculator surface is eventually split, organize it around four operational domains: **production line**, **warehouse and inventory**, **QC department**, and **management tools**.

**Why:** These are the user's real workflows and ownership boundaries, so they provide a more durable architecture than splitting purely by component size or current tab labels.

**How to apply:** Keep shared live-run state, sync, auth, navigation, and common calculation primitives in explicit shared modules. Each domain should own its UI and domain-specific orchestration, with lazy loading used where it improves startup. Preserve web/mobile parity and existing operational behavior while moving code.