---
name: Browser fixture server identifiers
description: Persisted recipe rows may gain server-owned identifiers during browser fixture writes.
---

Browser regression assertions should verify the business fields they own while allowing server-generated row identifiers.

**Why:** Recipe persistence now enriches rows with generated ingredient IDs, so exact object equality can fail even when the saved ingredient and weight are correct.

**How to apply:** For API-backed browser fixtures, use semantic object matching for persisted rows unless the identifier itself is the behavior under test.