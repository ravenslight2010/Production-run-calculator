# Build-version reporting implementation

Approved design: `../specs/2026-10-03-automatic-build-version-reporting-design.md`.
The referenced writing-plans skill is not installed; this is the local execution
plan, not a project-task creation or mode change.

1. Add bounded, deterministic source fingerprinting and verified local Git
   binding. Keep independent prepared records outside retained release reports.
2. Connect API/web build stages to the same prepared identity and seal only
   matching, completed stages. Development stamps cannot authorize release.
3. Add public, database-independent, no-store build metadata and its OpenAPI
   contract. Regenerate rather than edit generated files.
4. Add a bounded HTTP verification command and a source-match-only receipt.
   Keep legacy controlled handoff and GO gates unchanged.
5. Cover source changes, exclusions, Git availability/dirty state, build-stage
   failures, metadata immutability, route authorization, and HTTP failure modes
   with temporary filesystem fixtures and focused tests.
6. Run checks serially, restart the managed API once, verify the endpoint and
   existing public app. Do not push or publish. Document the next-publish flow.