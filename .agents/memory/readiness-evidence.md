---
name: Readiness evidence
description: Production readiness recovery records must be bounded, identity-bound, and projected from allowlisted health fields.
---

Readiness recovery evidence should be captured by a read-only probe that stores only fixed check statuses, bounded worker counts, operation names, and timestamps. Require a current, explicit provider-neutral deployment handoff containing the published deployment identifier and full deployed Git revision; never infer either from the verifier checkout or retain the target URL/body.

**Why:** Database-worker incidents need proof of fail-closed 503 behavior and later recovery, but health responses can contain diagnostic details that should not become retained operational evidence. A separate expiring handoff prevents an operator or verifier checkout from silently substituting deployment identity.

**How to apply:** Validate the bounded handoff before the first live probe, reject missing/stale/conflicting metadata, then use normal-operation mode for sustained 200 checks or recovery mode for a real worker-diagnostic 503 followed by a later 200. Cap samples and give the record an explicit expiry.

Published standard and full release verification must require the retained JSON
path and validate it against caller-supplied deployment and revision identities
before accepting GO. Development and disposable fixtures may opt out explicitly;
that opt-out must not be available to the published release command.

**Why:** A valid-but-missing readiness record otherwise leaves the release
evidence contract unable to distinguish a proven deployment from an unchecked
one.

**How to apply:** Keep the production requirement at the release verifier
boundary, require both identity arguments before validation, and require the GO
report to declare the retained readiness path.

## Publishing identity discovery

Prefer immutable, build-time source records for automatic version reporting,
compared with an independently prepared expected record.

**Why:** The owner approved automatic reporting after repeated manual publishing
lookups; GitHub is only a backup and cannot identify the active published source.

**How to apply:** Capture the actual build inputs and read the sealed artifact
identity, not a later workspace HEAD or mutable environment label. Keep existing
controlled handoff and release gates; a source match is not a production GO.
Do not retroactively assign this identity to an older build.

For this project's release handoffs, look for identity automatically before
asking the user to transcribe it. GitHub is a backup, not the publish source;
local Git version identifiers do not require a matching GitHub backup tip.
See [GitHub's project role](github-git-push.md) for that scope boundary.
The user identified the source as **Publishing
→ Logs → select the successful publish**, with `Deployment:` and `Build:` lines
near the beginning of the build log.

**Why:** A task requested identifiers manually even though the selected publish's
build log displayed them. Knowing that UI source should prevent repeated requests
without first investigating available build-log access.

**How to apply:** Check official deployment metadata and available publishing
build-log access, not only runtime logs. Distinguish the deployment UUID, build
UUID, and full Git revision: a build UUID or its shortened UI label is not proof
of the deployed commit. Read accessible Git commit identities directly rather
than asking the user to locate them in the Git UI; the additional release
requirement is proving which commit the intended publish contains.
Bind any extracted identifiers to the selected successful
publish and verify it is the intended/current deployment. A historical screenshot
does not establish current identity. If exposed tools cannot retrieve the build
log, report that access limitation accurately; do not claim the information is
absent from Replit or that automatic capture has been implemented.

Prefer the **Tools → Publishing → Overview → Current status → log icon**
source illustrated by the user when identifying the live build. Distinguish it
from older **Publish history** entries.

**Why:** The user's newer and older publishing screenshots showed the same
Deployment ID but different Build IDs and build dates. A deployment UUID alone
does not distinguish those builds, and an older history entry can supply the
wrong build for a live release check.

**How to apply:** Check the selected log's date against Current status; preserve
deployment and build identities separately, then establish the controlled Git
revision mapping. Screenshot-supplied IDs are manual observations, not proof that
automatic retrieval works or that the build matches a guessed Git branch tip.

### Bounded HTTP probes in the execution sandbox

Do not assume the impure execution sandbox exposes the browser `AbortSignal`
global alongside `fetch`.

**Why:** A bounded release-identity probe failed before issuing its requests
because `AbortSignal` was undefined. Equivalent shell-driven Python HTTP probes
with explicit timeouts worked.

**How to apply:** If that global is unavailable, use a shell HTTP client with a
request timeout and output only allowlisted identity/status fields. Never remove
timeouts or retain full production responses merely to work around the sandbox.
