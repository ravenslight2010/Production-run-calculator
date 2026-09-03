#!/usr/bin/env python3
"""Regression tests for the dependency-free quick skill validator."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


VALIDATOR = Path(__file__).with_name("quick_validate.py")


class QuickValidateCliTest(unittest.TestCase):
    def run_validator(self, skill_markdown):
        with tempfile.TemporaryDirectory() as temporary_directory:
            skill_directory = Path(temporary_directory) / "fixture-skill"
            skill_directory.mkdir()
            (skill_directory / "SKILL.md").write_text(skill_markdown, encoding="utf-8")
            return subprocess.run(
                [sys.executable, "-S", str(VALIDATOR), str(skill_directory)],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_valid_folded_metadata_passes_without_site_packages(self):
        result = self.run_validator(
            "---\n"
            "name: valid-skill\n"
            "description: >\n"
            "  A valid fixture\n"
            "  with folded metadata.\n"
            "custom-field: accepted by the repository catalog\n"
            "---\n"
            "# Instructions\n"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "Skill is valid!\n")

    def test_malformed_frontmatter_fails_deterministically(self):
        result = self.run_validator(
            "---\n"
            "name: malformed-skill\n"
            "description: first\n"
            "description: duplicate\n"
            "---\n"
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(
            result.stdout,
            "Duplicate frontmatter field 'description' (line 4)\n",
        )

    def test_catalog_invalid_name_fails(self):
        result = self.run_validator(
            "---\nname: Not Valid\ndescription: Present\n---\n"
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(
            result.stdout,
            "Name 'Not Valid' must use lowercase letters and digits separated by single hyphens\n",
        )


if __name__ == "__main__":
    unittest.main()