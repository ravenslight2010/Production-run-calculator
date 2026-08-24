---
name: Sync HTTP failure handling
description: The sync client must distinguish parseable error bodies from successful acknowledgments.
---

The sync client must branch on the HTTP success status before treating a write response as an acknowledgment. A response can contain valid JSON and still represent an unsaved local change when its status is non-OK.

**Why:** A non-401 server failure was parsed successfully and then fell through the success path, clearing the retained-change warning and preventing the retry action from appearing.

**How to apply:** When changing sync response parsing or retry behavior, test a controlled 5xx write at phone width and verify the failed status, retained-change guidance, and manual retry control.