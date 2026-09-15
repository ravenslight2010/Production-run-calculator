---
name: Container image release evidence
description: How published container digests are bound to the reviewed source revision.
---

Published image evidence must bind each immutable registry digest to the exact reviewed commit through an OCI revision label and a post-push pull-by-digest check. A commit-SHA tag alone is not sufficient proof.

**Why:** Tags can be moved or misapplied, while a later audit needs to distinguish the pushed image bytes from the source revision that was reviewed.

Promotion must additionally bind the retained evidence to the trusted publisher workflow run and artifact digest. The privileged boundary may emit or consume only repository-plus-digest references; tags and source rebuilds are not equivalent.

**How to apply:** For every trusted image publisher, capture the build-push digest, pull the image by `image@digest`, verify the pulled RepoDigest and `org.opencontainers.image.revision`, and retain only bounded metadata without credentials. Before promotion, verify the successful publisher job, workflow/run/revision, downloaded artifact bytes, expected repositories, and all required component digests.