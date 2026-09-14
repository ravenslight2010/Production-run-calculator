#!/usr/bin/env python3
"""Focused tests for the read-only uploaded ZIP inventory."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from zip_asset_inventory import (
    DEFAULT_MAX_EXPANDED_BYTES,
    inspect_archive,
    inventory_archives,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPOSITORY_ROOT / "attached_assets"


class ZipAssetInventoryTests(unittest.TestCase):
    def test_current_exact_duplicate_pairs_are_reconciled_by_hash(self) -> None:
        pairs = [
            (
                "awesome-claude-code-main_1789335929493.zip",
                "awesome-claude-code-main_1789336705388.zip",
            ),
            (
                "codexskills-main_1788409954395.zip",
                "codexskills-main_1789337301209.zip",
            ),
        ]

        report = inventory_archives(
            [ASSET_ROOT / name for pair in pairs for name in pair]
        )

        self.assertEqual(report["summary"]["duplicate_archive_group_count"], 2)
        self.assertEqual(report["summary"]["duplicate_archive_count"], 2)
        archives = report["archives"]
        self.assertEqual(len(archives), 4)
        for first, second in zip(archives[::2], archives[1::2]):
            self.assertEqual(first["sha256"], second["sha256"])
            self.assertTrue(first["archive_duplicate"])
            self.assertTrue(second["archive_duplicate"])
            self.assertFalse(first["unsafe_metadata"])
            self.assertFalse(second["unsafe_metadata"])

    def test_current_report_symlink_archives_are_detected_without_opening_members(
        self,
    ) -> None:
        expected = {
            "CyberStrike-main_1789345857863.zip",
            "agent-teams-ai-main_1789345857724.zip",
            "agentic-awesome-skills-main_1789345857674.zip",
            "claude-code-settings-main_1789345857743.zip",
            "superpowers-main_1789337301193.zip",
        }
        report = inventory_archives([ASSET_ROOT])
        actual = {
            archive["filename"]
            for archive in report["archives"]
            if archive["symlink_count"]
        }

        self.assertEqual(actual, expected)
        self.assertTrue(all(archive["unsafe_metadata"] for archive in report["archives"] if archive["filename"] in expected))
        self.assertFalse(report["member_data_opened"])
        self.assertTrue(report["read_only"])

    def test_unsafe_metadata_and_limits_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "unsafe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../escape.txt", "x")
                archive.writestr("./same.txt", "x")
                archive.writestr("same.txt", "x")
                archive.writestr("SAME.TXT", "x")
                archive.writestr(".env", "not read")
                archive.writestr("large.bin", "123456")
                encrypted = zipfile.ZipInfo("encrypted.txt")
                archive.writestr(encrypted, "x")
                link = zipfile.ZipInfo("link")
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(link, "target")

            # zipfile intentionally clears the encryption bit when writing.
            # Patch only the fixture's header flags so the scanner can verify
            # that it reads metadata without attempting decryption.
            data = bytearray(archive_path.read_bytes())
            central_signature = b"PK\x01\x02"
            local_signature = b"PK\x03\x04"
            central_offset = data.find(central_signature)
            self.assertGreaterEqual(central_offset, 0)
            data[central_offset + 8 : central_offset + 10] = (1).to_bytes(
                2, "little"
            )
            local_offset = data.find(local_signature)
            self.assertGreaterEqual(local_offset, 0)
            data[local_offset + 6 : local_offset + 8] = (1).to_bytes(
                2, "little"
            )
            archive_path.write_bytes(data)

            result = inspect_archive(
                archive_path,
                max_entries=7,
                max_entry_bytes=2,
                max_expanded_bytes=5,
            )
            self.assertGreater(result["unsafe_path_count"], 0)
            self.assertGreater(result["duplicate_normalized_path_count"], 0)
            self.assertGreater(result["case_fold_collision_count"], 0)
            self.assertEqual(result["encrypted_entry_count"], 1)
            self.assertEqual(result["symlink_count"], 1)
            self.assertGreater(result["credential_like_path_count"], 0)
            self.assertTrue(result["entry_limit_exceeded"])
            self.assertTrue(result["entry_size_limit_exceeded"])
            self.assertTrue(result["expanded_size_limit_exceeded"])
            self.assertTrue(result["unsafe_metadata"])

            process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    str(archive_path),
                    "--max-entries",
                    "7",
                    "--max-entry-bytes",
                    "2",
                    "--max-expanded-bytes",
                    "5",
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )
            self.assertEqual(process.returncode, 1)
            output = json.loads(process.stdout)
            self.assertEqual(
                output["archives"][0]["credential_like_path_count"],
                1,
            )
            self.assertNotIn(".env", process.stdout)
            self.assertNotIn("encrypted.txt", process.stdout)
            self.assertIn("NOT INSTALLATION APPROVAL", process.stdout)

    def test_canonically_equivalent_member_names_are_redacted_and_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "unicode-equivalent.zip"
            composed = "reports/café.txt"
            decomposed = "reports/cafe\u0301.txt"
            self.assertNotEqual(composed, decomposed)

            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(composed, "not read")
                archive.writestr(decomposed, "not read")

            result = inspect_archive(archive_path)
            self.assertEqual(result["duplicate_normalized_path_count"], 1)
            self.assertEqual(result["unicode_normalization_collision_count"], 1)
            self.assertTrue(result["unsafe_metadata"])
            self.assertEqual(result["status"], "unsafe-metadata")

            report = inventory_archives([archive_path])
            self.assertEqual(report["member_name_unicode_normalization"], "NFC")
            self.assertFalse(report["member_data_opened"])
            serialized = json.dumps(report, ensure_ascii=False)
            self.assertNotIn(composed, serialized)
            self.assertNotIn(decomposed, serialized)

            process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    str(archive_path),
                    "--format",
                    "text",
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )
            self.assertEqual(process.returncode, 1)
            self.assertIn("unicode_normalization_collisions=1", process.stdout)
            self.assertNotIn(composed, process.stdout)
            self.assertNotIn(decomposed, process.stdout)

    def test_malformed_archive_is_an_error_not_a_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "not-a-zip.zip"
            archive_path.write_bytes(b"not a zip")
            result = inspect_archive(archive_path)
            self.assertEqual(result["status"], "error")
            self.assertIn("malformed_zip", result["error_codes"])
            self.assertTrue(result["unsafe_metadata"])

    def test_default_expanded_limit_covers_current_upload_batch(self) -> None:
        report = inventory_archives([ASSET_ROOT])
        self.assertEqual(report["limits"]["max_expanded_bytes"], DEFAULT_MAX_EXPANDED_BYTES)
        self.assertFalse(
            any(
                archive["expanded_size_limit_exceeded"]
                for archive in report["archives"]
            )
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)