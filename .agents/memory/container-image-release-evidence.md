---
name: Container image release evidence
description: How published container digests are bound to the reviewed source revision.
---

Published image evidence must bind each immutable registry digest to the exact reviewed commit through an OCI revision label and a post-push pull-by-digest check. A commit-SHA tag alone is not sufficient proof.

**Why:** Tags can be moved or misapplied, while a later audit needs to distinguish the pushed image bytes from the source revision that was reviewed.

**How to apply:** For every trusted image publisher, capture the build-push digest, pull the image by `image@digest`, verify the pulled RepoDigest and `org.opencontainers.image.revision`, and retain only bounded metadata without credentials.