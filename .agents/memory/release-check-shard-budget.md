---
name: Release-check shard budget
description: API release shards are serialized and the capability-matrix shard can exceed the default four-minute budget.
---

The release checker’s API shard timeout must reflect serialized Vitest runtime, not the usual individual-test runtime; a healthy capability-matrix shard can take several minutes.

**Why:** A release run can report an infrastructure timeout even when the complete shard passes when isolated, creating a false NO-GO.

**How to apply:** When API integration coverage or its fixture set grows, compare the slowest serialized shard duration with the checker budget and retain a warning margin. The Replit shell runner may cap one foreground command at five minutes, so validate long release runs by executing the exact bounded shards individually when needed.