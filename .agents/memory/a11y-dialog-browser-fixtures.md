---
name: A11y dialog browser fixtures
description: Why browser accessibility fixtures must seed manager capabilities before checking gated import entry points
---

Import-dialog browser checks must seed the manager role and its capabilities in the disposable database before the authenticated shell loads. A stale role catalog can make valid gated entry points disappear, producing misleading selector timeouts instead of testing dialog behavior.

**Why:** The browser shell hides spec, guide, premix, and cheese import controls when the manager role lacks the corresponding AI, profile, or inventory capabilities, and disposable databases may predate the current role seed.

**How to apply:** In manager-facing browser fixtures, assign the test user the manager role and update its capabilities before waiting for the authenticated application shell; keep the fixture cleanup scoped to the test account.