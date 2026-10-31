---
name: Container image release evidence
description: Container-artifact provenance practices; does not establish the active app's production publication or live identity.
---

## Scope

These are provenance practices for container artifacts in an authorized
image-registry workflow. They do not authorize publishing the active
production app through GitHub, a container registry, Render, or Docker, and
they do not prove what the live app is serving. `replit.md` is authoritative
for the current production publishing path.

For a container artifact, bind each immutable registry digest to the exact
reviewed commit through an OCI revision label and a post-push pull-by-digest
check. A commit-SHA tag alone is not sufficient proof.

**Why:** Tags can be moved or misapplied, while a later audit needs to distinguish the pushed image bytes from the source revision that was reviewed.

Promotion must additionally bind the retained evidence to the trusted publisher workflow run and artifact digest. The privileged boundary may emit or consume only repository-plus-digest references; tags and source rebuilds are not equivalent.

**How to apply:** When an authorized workflow publishes a container artifact,
capture the build-push digest, pull the image by `image@digest`, verify the
pulled RepoDigest and `org.opencontainers.image.revision`, and retain only
bounded metadata without credentials. Before promoting that artifact within
its own explicitly authorized workflow, verify the successful publisher job,
workflow/run/revision, downloaded artifact bytes, expected repositories, and
all required component digests. This container evidence is not production-app
publication or live-build evidence.