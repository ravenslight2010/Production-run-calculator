---
name: Readiness evidence
description: Production readiness recovery records must be bounded, identity-bound, and projected from allowlisted health fields.
---

## Owner-directed identity transition

Git/GitHub identifiers must no longer be prerequisites for tests or readiness.
Use independently captured source fingerprints and application-owned build
identity as the primary binding. Keep Git as optional metadata and preserve
historical Git-bound records without relabeling them.

**Why:** The owner explicitly rejected a mandatory Git revision after the
published source fingerprint matched but the older readiness contract blocked.
GitHub is only a backup in this project's publishing workflow.

**How to apply:** Preserve Git-only historical records through explicit legacy
readers, not as new prerequisites. Keep evidence producers and consumers aligned;
preserve expiry, health, security, production-data provenance, and matching-test
guards. Production-source fingerprints exclude tests, so bind
test evidence separately to the current verification inputs.

Readiness recovery evidence should be captured by a read-only probe that stores only fixed check statuses, bounded worker counts, operation names, and timestamps. Require a fresh, source-based handoff bound to an independent expected record and the live application build; never infer published identity from the verifier checkout or retain the target URL/body. Git-only handoffs are historical compatibility records, not new prerequisites.

**Why:** Database-worker incidents need proof of fail-closed 503 behavior and later recovery, but health responses can contain diagnostic details that should not become retained operational evidence. A separate expiring handoff prevents an operator or verifier checkout from silently substituting deployment identity.

**How to apply:** Validate the bounded handoff before the first live probe, reject missing/stale/conflicting metadata, then use normal-operation mode for sustained 200 checks or recovery mode for a real worker-diagnostic 503 followed by a later 200. Cap samples and give the record an explicit expiry.

Published standard and full release verification must require the retained JSON
path and validate it against caller-supplied deployment and revision identities
before accepting GO. Identity includes production source and separate verification
inputs; old results cannot satisfy changed test requirements. Development and disposable fixtures may opt out explicitly;
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

Finalize artifact identity only after the compiler and post-build validators
have succeeded and all generated assets are complete.

**Why:** Vite's `writeBundle` can precede PWA asset generation, while
`closeBundle` can run after a failed build. Neither hook alone proves a complete
successful artifact.

**How to apply:** Keep final completion outside those hooks; a failed compiler
or post-build validator must not produce a successful completion marker.

For this project's release handoffs, look for identity automatically before
asking the user to transcribe it. GitHub is a backup, not the publish source;
Git identifiers and backup-tip equality are not test/readiness prerequisites.
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
of a deployed commit. Git commit annotations are optional; the required binding
is proving the intended publish's application build and source fingerprint
against an independently captured expectation.
Bind any extracted identifiers to the selected successful
publish and verify it is the intended/current deployment. A historical screenshot
does not establish current identity. If exposed tools cannot retrieve the build
log, report that access limitation accurately; do not claim the information is
absent from Replit or that automatic Replit deployment/Build UUID capture has
been implemented. Application-owned artifact identifiers are a separate namespace.

Prefer the **Tools → Publishing → Overview → Current status → log icon**
source illustrated by the user when identifying the live build. Distinguish it
from older **Publish history** entries.

**Why:** The user's newer and older publishing screenshots showed the same
Deployment ID but different Build IDs and build dates. A deployment UUID alone
does not distinguish those builds, and an older history entry can supply the
wrong build for a live release check.

**How to apply:** Check the selected log's date against Current status; preserve
deployment and build identities separately, then establish independently verified
source binding. Screenshot-supplied IDs are manual observations, not proof that
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

### Node HTTPS trust in this workspace

Use the pinned Node runtime's `--use-system-ca` flag for a bounded HTTPS probe
when its bundled CA store fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` but the
system-trust HTTPS client successfully verifies the same official target.

**Why:** The published source-version lookup encountered this workspace trust
store difference. Enabling system CA trust completed the lookup while keeping
certificate verification enabled.

**How to apply:** Run the verifier through the pinned Node wrapper with
`node --use-system-ca`; never disable TLS verification or substitute a
development URL. Keep the independent prepared expectation and normal timeout
and response limits.

When a probe also imports TypeScript, preload `tsx` in that same Node process
instead of relying on the separate `tsx` command-line launcher to preserve
runtime trust options.

**Why:** A direct Node probe with system CA trust and the TypeScript loader
successfully performed the bounded readiness observation in this workspace.

**How to apply:** Use the pinned wrapper with
`node --use-system-ca --import ./scripts/node_modules/tsx/dist/loader.mjs`;
keep captures observation-only if controlled deployment identity is missing.

### Workflow-linter executable discovery

An installed actionlint package shim is not proof that its native linter can
launch. Do not use that shim as an `ACTIONLINT_BIN` override.

**Why:** Pointing the override at the package shim produced a process-spawning
failure (`Cannot fork`) and a timeout, despite the package and pin being present.

**How to apply:** Prefer package-manager executable discovery, or an explicitly
verified native executable. Report YAML parsing and configuration prechecks
separately from a completed actionlint run; a blocked linter is not a pass.
