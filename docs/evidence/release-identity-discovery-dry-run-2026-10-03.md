# Release identity discovery — read-only dry run

Date: 2026-10-03. Public HTTP probe capture began at 23:10:07 UTC;
Git/service/log observations were collected earlier in the same dry run.
This is an information-discovery test, not release approval or a full release run.

## Results

| Source / check | Observed result |
| --- | --- |
| Local `git rev-parse HEAD` | `604e38b493e9c88337592da23d9e100b784012d9` at capture time; identifies the workspace, not the published app |
| Live `git ls-remote origin refs/heads/Replit refs/heads/main` | Successful lookup against a GitHub-hosted origin |
| GitHub `Replit` branch | `3412b790bfd392e1fb0c815ea433e068ff5d7a3b` |
| GitHub `main` branch | `823dc6d836c1e0b86f1841a205702466d477dc6a` |
| Official deployment metadata | Existing successful public autoscale deployment; response contains no deployment ID, build ID, or deployed Git revision |
| Deployment log search | No matching deployment/build/revision identity lines returned by the exposed log tool; this is not proof the selected publishing build log lacks those lines |
| Public page `HEAD` | HTTP 200; none of the allowlisted deployment/build/commit identity headers returned |
| Public `/api/readyz` | HTTP 200, `status: ok`; no deployment/build/revision fields returned |
| Current automatic-discovery values passed to the real handoff validator | Correctly rejected: `Readiness deployment handoff deployment ID is malformed` |
| User screenshot's deployment ID, without a deployed commit, passed to the real handoff validator | Correctly rejected: `Readiness deployment handoff deployed revision is malformed` |

Both negative validator cases PASS: missing identity cannot authorize capture.
They used in-memory mock handoff envelopes; no handoff or release approval was
created or saved. The screenshot case is manually supplied historical information,
not automatically retrieved or verified current deployment identity.

## Conclusion

**Git discovery works. Complete automatic published identity discovery remains
incomplete with the exposed sources tested here.** None of the observed sources
proves which GitHub commit the intended live publish contains. In particular, the
workspace revision differs from both remotely verified branch tips.

The app's operational-report implementation can report runtime identity to
authorized reviewers, but classifies it as unverified rather than a controlled
deployment handoff. No production sign-in or authenticated operational-report
request was performed in this dry run.

Do not substitute a GitHub branch tip, workspace HEAD, build UUID, or healthy
HTTP response for a verified deployed revision. The next missing input is a
current, controlled mapping between the intended publish's deployment ID and
its full Git revision, with the required validity window.

## Safety and evidence scope

- Only Git reads, deployment metadata/log discovery, public HTTP reads, and the
  pure handoff validator ran.
- No push, publish, application change, production database query/mutation,
  authentication session creation, full browser suite, or full release suite.
- Retained content is limited to safe commit identifiers, statuses, and bounded
  validation errors. No credentials, remote URLs, cookies, raw log/response
  bodies, recipe data, or personal account information are retained.
- A first sandbox HTTP attempt failed because `AbortSignal` was unavailable.
  The replacement Python HTTP probes used explicit 15-second timeouts and
  completed successfully.