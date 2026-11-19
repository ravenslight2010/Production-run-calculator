---
name: version-diff
description: Use when comparing v1 (Production-run-calculator) vs v2 (Lucias-production-assistant-v2) or planning ports of features to a future v3. Helps decide what to keep, rewrite, or drop.
---

# Version Diff / Multi-Version Skill

## Purpose
Systematically compare behavior, data models, and workflows between v1 and v2 (and future versions) so the agent can make good porting or rewrite decisions.

## When to use
- “How does this work in v1 vs v2?”
- Planning to port a feature
- Deciding whether to reuse domain rules or rewrite
- Multi-repo work where the agent is switching between versions

## Core rules
1. V2 is a greenfield rebuild with a cleaner spine (Clerk, facility tenancy, revision-safe runs). It is not a feature clone.
2. Port what the floor needs to run a day; leave the rest until the core path works.
3. Prefer V2 transactional / revision / outbox model.
4. Never share V1 database or credentials with V2.

## Workflow
1. State which version(s) are in scope.
2. Summarize the current V1 implementation of the feature (from code or known maps).
3. Summarize the current V2 state (Done / Partial / Missing / Defer).
4. Recommend: port rules only, rewrite on V2 primitives, or defer.
5. List the concrete files or types that would be touched.

## Output
- Side-by-side comparison table
- Recommended action (port / rewrite / defer)
- Risk list
- Suggested first vertical slice
