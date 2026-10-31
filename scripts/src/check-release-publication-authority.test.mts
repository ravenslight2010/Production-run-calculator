import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReleasePublicationAuthority,
  formatReleasePublicationAuthorityFindings,
  RELEASE_PUBLICATION_DOCUMENTS,
} from "./check-release-publication-authority.mts";

const authority =
  "The Replit deployment is the only authorized current publisher of the active production app.";

function documents(
  overrides: Partial<Record<(typeof RELEASE_PUBLICATION_DOCUMENTS)[number], string>> = {},
): Map<string, string> {
  return new Map(
    RELEASE_PUBLICATION_DOCUMENTS.map((document) => [
      document,
      overrides[document] ?? authority,
    ]),
  );
}

test("accepts current Replit authority and clearly labeled legacy instructions", () => {
  const content = [
    authority,
    "",
    "## Legacy container deployment reference",
    "The former Render service deployed this production app using Docker.",
    "",
    "## Local example",
    "Example: Render deploys a production app from an image.",
    "",
    "```bash",
    "docker compose up --build",
    "```",
  ].join("\n");

  assert.deepEqual(
    checkReleasePublicationAuthority(
      documents({ "README.md": content }),
    ),
    [],
  );
});

test("does not let a historical sentence hide a later current-provider claim", () => {
  const content = [
    authority,
    "The former Render workflow was used for production. Render now publishes the active production app.",
  ].join("\n\n");
  const findings = checkReleasePublicationAuthority(
    documents({ "README.md": content }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.claim ?? "", /Render now publishes/);
});

test("accepts explicit statements that GitHub and container builds are not live proof", () => {
  const content = [
    authority,
    "GitHub pushes and Docker image builds do not publish the active app or prove what is live.",
  ].join("\n\n");
  assert.deepEqual(
    checkReleasePublicationAuthority(
      documents({ "docs/release-operations.md": content }),
    ),
    [],
  );
});

test("accepts paired neither/nor denials of publication and live proof", () => {
  const content = [
    authority,
    "GitHub releases and container builds neither publish the active app nor prove what is live.",
  ].join("\n\n");
  assert.deepEqual(
    checkReleasePublicationAuthority(
      documents({ "docs/release-evidence-handoff.md": content }),
    ),
    [],
  );
});

test("does not treat GitHub source releases as publishing the active app", () => {
  const content = [
    authority,
    "The current production app is served by Replit, while GitHub publishes source releases.",
  ].join("\n\n");
  assert.deepEqual(
    checkReleasePublicationAuthority(
      documents({ "docs/release-operations.md": content }),
    ),
    [],
  );
});

test("reports a current GitHub publishing claim with its document and sentence", () => {
  const conflicting =
    "GitHub Actions publishes the active production app for each release.";
  const findings = checkReleasePublicationAuthority(
    documents({ "README.md": `${authority}\n\n${conflicting}` }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.document, "README.md");
  assert.equal(findings[0]?.line, 3);
  assert.match(findings[0]?.claim ?? "", /GitHub Actions publishes/);
  assert.match(
    formatReleasePublicationAuthorityFindings(findings),
    /README\.md:3: conflicting publication claim:/,
  );
});

test("reports a current Render publisher and Docker live-proof claim", () => {
  const content = [
    authority,
    "The active production app is deployed on Render.",
    "A Docker image proves the current live deployment identity.",
  ].join("\n\n");
  const findings = checkReleasePublicationAuthority(
    documents({ "docs/release-evidence-handoff.md": content }),
  );

  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.document, "docs/release-evidence-handoff.md");
  assert.match(findings[0]?.claim ?? "", /deployed on Render/);
  assert.match(findings[1]?.claim ?? "", /Docker image proves/);
});

test("reports GitHub CI artifacts claimed as live deployment verification", () => {
  const claim =
    "GitHub CI artifacts verify the current production deployment identity.";
  const findings = checkReleasePublicationAuthority(
    documents({ "README.md": `${authority}\n\n${claim}` }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.claim ?? "", /verify the current production/);
});

test("requires Replit publisher wording in each maintained guide", () => {
  const findings = checkReleasePublicationAuthority(
    documents({
      "docs/release-operations.md":
        "Release tests require current deployment identity before running.",
    }),
  );

  assert.deepEqual(findings, [
    {
      document: "docs/release-operations.md",
      line: 1,
      claim:
        "does not identify Replit as the current publisher of the active production app",
    },
  ]);
});

test("accepts the authority wording used in replit.md", () => {
  const wording =
    "Only the Replit deployment is authorized to publish the active production app.";
  assert.deepEqual(
    checkReleasePublicationAuthority(
      documents({ "replit.md": wording }),
    ),
    [],
  );
});

test("reports missing required documents by path", () => {
  const input = documents();
  input.delete("docs/release-evidence-handoff.md");
  const findings = checkReleasePublicationAuthority(input);

  assert.deepEqual(findings, [
    {
      document: "docs/release-evidence-handoff.md",
      line: 1,
      claim: "required public release document is missing",
    },
  ]);
});
