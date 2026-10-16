import json
from pathlib import Path
import tempfile
import unittest

import check_ai_knowledge as check


class AppKnowledgeManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.knowledge = self.root / "lib/ai-evaluation/src/appKnowledge.ts"
        self.source = self.root / "docs/source.md"
        self.manifest = self.root / "docs/ai-knowledge/manifest.json"
        self.source.parent.mkdir(parents=True)
        self.knowledge.parent.mkdir(parents=True)
        self.source.write_text("Stable source evidence.\n")
        self.write_knowledge("2026-10-16.1", "approved fact")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_knowledge(self, version, fact):
        self.knowledge.write_text(
            f'export const APP_KNOWLEDGE_VERSION = "{version}";\n'
            f'{{ path: "docs/source.md", anchor: "{fact}" }}\n'
        )

    def test_manifest_tracks_knowledge_and_source_hashes(self):
        current = check.build_snapshot(self.root, self.knowledge)
        self.assertEqual(current["format"], check.MANIFEST_FORMAT)
        self.assertEqual(current["sourceManifestVersion"], 1)
        self.assertEqual(current["knowledgeVersion"], "2026-10-16.1")
        self.assertEqual(current["sources"][0]["path"], "docs/source.md")
        self.assertEqual(len(current["sources"][0]["sha256"]), 64)

    def test_source_manifest_schema_migration_does_not_claim_knowledge_changed(self):
        check.update_manifest(self.root, self.knowledge, self.manifest)
        stored = json.loads(self.manifest.read_text())
        stored["manifestVersion"] = stored.pop("sourceManifestVersion")
        self.manifest.write_text(json.dumps(stored))

        check.update_manifest(self.root, self.knowledge, self.manifest)

        migrated = json.loads(self.manifest.read_text())
        self.assertNotIn("manifestVersion", migrated)
        self.assertEqual(migrated["sourceManifestVersion"], 1)
        self.assertEqual(migrated["knowledgeVersion"], "2026-10-16.1")
        self.assertEqual(check.check_manifest(self.root, self.knowledge, self.manifest), [])

    def test_stale_source_is_rejected_until_review_and_version_bump(self):
        check.update_manifest(self.root, self.knowledge, self.manifest)
        self.source.write_text("Changed source evidence.\n")
        self.assertIn(
            "sources",
            check.check_manifest(self.root, self.knowledge, self.manifest),
        )
        with self.assertRaisesRegex(ValueError, "version bump"):
            check.update_manifest(self.root, self.knowledge, self.manifest)

        self.write_knowledge("2026-10-16.2", "reviewed updated fact")
        check.update_manifest(self.root, self.knowledge, self.manifest)
        self.assertEqual(
            check.check_manifest(self.root, self.knowledge, self.manifest),
            [],
        )

    def test_stale_knowledge_file_requires_version_bump(self):
        check.update_manifest(self.root, self.knowledge, self.manifest)
        self.write_knowledge("2026-10-16.1", "unreviewed changed fact")
        with self.assertRaisesRegex(ValueError, "version bump"):
            check.update_manifest(self.root, self.knowledge, self.manifest)

    def test_manifest_does_not_follow_references_outside_repository(self):
        outside = Path(self.temporary_directory.name).parent / "outside-source.md"
        try:
            outside.write_text("outside\n")
            self.knowledge.write_text(
                'export const APP_KNOWLEDGE_VERSION = "2026-10-16.1";\n'
                '{ path: "../outside-source.md", anchor: "outside" }\n'
            )
            with self.assertRaisesRegex(ValueError, "inside the repository"):
                check.build_snapshot(self.root, self.knowledge)
        finally:
            outside.unlink(missing_ok=True)

    def test_stale_manifest_negative_control(self):
        check.update_manifest(self.root, self.knowledge, self.manifest)
        stored = json.loads(self.manifest.read_text())
        stored["knowledgeFileSha256"] = "0" * 64
        self.manifest.write_text(json.dumps(stored))
        self.assertIn(
            "knowledgeFileSha256",
            check.check_manifest(self.root, self.knowledge, self.manifest),
        )


if __name__ == "__main__":
    unittest.main()
