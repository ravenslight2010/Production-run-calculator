---
name: GitHub external-fork verification
description: Live fork PR checks require a fork owned outside the connected GitHub account.
---

The connected GitHub account cannot create a distinct fork of its own repository
under the same owner. A real forked pull-request workflow test therefore needs
an existing fork owned by another account (or an organization namespace), plus
the normal first-time-contributor approval path.

**Why:** A same-owner fork request can be accepted by the GitHub API without
producing a usable fork, so treating the API response as proof creates a false
live-verification result.

**How to apply:** Check the fork network and organization namespaces before
attempting the test. If neither is available, document the repository Actions
settings and report the live check as blocked rather than substituting a
same-repository fixture.