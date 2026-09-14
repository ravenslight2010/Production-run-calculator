#!/usr/bin/env python3
"""Focused tests for the read-only uploaded ZIP inventory."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from copy import deepcopy

from zip_asset_inventory import (
    COMMAND_ID,
    DEFAULT_MAX_EXPANDED_BYTES,
    MAX_RETAINED_REVIEW_BYTES,
    REVIEW_LABEL,
    classify_environment,
    current_revision,
    inspect_archive,
    inventory_archives,
    report_integrity_sha256,
    validate_review_report,
    verify_report_integrity,
    verify_retained_report,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPOSITORY_ROOT / "attached_assets"


class ZipAssetInventoryTests(unittest.TestCase):
    def _safe_report(self) -> dict[str, object]:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "safe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("safe.txt", "review metadata only")
            return inventory_archives([archive_path])

    def test_current_report_is_accepted_by_retained_report_validator(self) -> None:
        report = self._safe_report()
        self.assertEqual(validate_review_report(report), ())

    def test_legacy_report_without_provenance_is_rejected(self) -> None:
        report = self._safe_report()
        del report["provenance"]
        self.assertEqual(validate_review_report(report), ("report_schema",))

    def test_malformed_provenance_and_label_are_rejected_without_echoing_values(
        self,
    ) -> None:
        report = self._safe_report()
        provenance = report["provenance"]
        assert isinstance(provenance, dict)
        provenance["captured_at"] = "../../secret-capture.json"
        provenance["command"] = "python3 scanner.py --output /tmp/private.json"
        report["label"] = "approved for installation"
        errors = validate_review_report(report)
        self.assertIn("provenance_captured_at", errors)
        self.assertIn("provenance_command", errors)
        self.assertIn("label", errors)
        self.assertNotIn("secret-capture.json", json.dumps(errors))
        self.assertNotIn("private.json", json.dumps(errors))

    def test_sensitive_looking_extra_fields_and_error_values_are_rejected(self) -> None:
        report = self._safe_report()
        report["request_path"] = "/tmp/credentials.json"
        self.assertIn("report_schema", validate_review_report(report))

        report = self._safe_report()
        archive = report["archives"][0]
        assert isinstance(archive, dict)
        archive["error_codes"] = ["member=private-key.pem"]
        errors = validate_review_report(report)
        self.assertIn("archive_0_error_codes", errors)

    def test_retained_report_cli_accepts_current_json_and_rejects_legacy_json(
        self,
    ) -> None:
        report = self._safe_report()
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "review.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            valid_process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    "--validate-report",
                    str(report_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(valid_process.returncode, 0)
            self.assertEqual(json.loads(valid_process.stdout), {"valid": True, "errors": []})

            legacy = deepcopy(report)
            del legacy["provenance"]
            report_path.write_text(json.dumps(legacy), encoding="utf-8")
            invalid_process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    "--validate-report",
                    str(report_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(invalid_process.returncode, 1)
            self.assertEqual(
                json.loads(invalid_process.stdout),
                {"valid": False, "errors": ["report_schema"]},
            )

    def test_report_has_bounded_scan_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "safe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("safe.txt", "review metadata only")

            report = inventory_archives([archive_path])

        provenance = report["provenance"]
        self.assertEqual(provenance["command"], COMMAND_ID)
        self.assertIn(
            provenance["environment"],
            {"development", "isolated-test", "staging", "production", "unknown"},
        )
        self.assertLessEqual(len(provenance["captured_at"]), 32)
        self.assertRegex(
            provenance["captured_at"],
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$",
        )
        self.assertTrue(
            provenance["revision"] == "unknown"
            or re.fullmatch(r"[0-9a-f]{7,64}", provenance["revision"])
        )
        self.assertNotIn(str(Path(directory)), json.dumps(report))

    def test_report_integrity_covers_all_fields_without_hashing_itself(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "safe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("safe.txt", "review metadata only")

            report = inventory_archives([archive_path])

        integrity = report["integrity"]
        self.assertEqual(integrity["algorithm"], "sha256")
        self.assertEqual(integrity["scope"], "report-excluding-integrity")
        self.assertRegex(integrity["sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(verify_report_integrity(report))
        self.assertEqual(integrity["sha256"], report_integrity_sha256(report))

        changed_report = json.loads(json.dumps(report))
        changed_report["summary"]["archive_count"] = 99
        self.assertFalse(verify_report_integrity(changed_report))

        changed_integrity = json.loads(json.dumps(report))
        changed_integrity["integrity"]["scope"] = "report-including-integrity"
        self.assertTrue(
            report_integrity_sha256(changed_integrity)
            == report_integrity_sha256(report)
        )
        self.assertFalse(verify_report_integrity(changed_integrity))

    def test_environment_classification_uses_only_approved_classes(self) -> None:
        self.assertEqual(
            classify_environment({"ZIP_ASSET_INVENTORY_ENVIRONMENT": "staging"}),
            "staging",
        )
        self.assertEqual(
            classify_environment(
                {
                    "REPLIT_ENVIRONMENT": "production",
                    "REPLIT_DEPLOYMENT_ID": "",
                    "CI": "",
                }
            ),
            "unknown",
        )
        self.assertEqual(
            classify_environment({"CI": "true"}),
            "isolated-test",
        )
        self.assertEqual(
            classify_environment({"REPLIT_DEPLOYMENT_ID": "deployment-marker"}),
            "production",
        )

    def test_revision_lookup_fails_closed_without_leaking_git_errors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(current_revision(Path(directory)), "unknown")

    def test_output_option_retains_json_without_echoing_local_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "safe.zip"
            output_path = Path(directory) / "review.json"
            with zipfile.ZipFile(archive_path, "w") as archive:
                safe_entry = zipfile.ZipInfo("safe.txt")
                safe_entry.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(safe_entry, "review metadata only")

            process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    str(archive_path),
                    "--output",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )

            self.assertEqual(process.returncode, 0)
            self.assertEqual(process.stdout, "")
            retained = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(
                retained["label"], REVIEW_LABEL
            )
            self.assertEqual(retained["provenance"]["command"], COMMAND_ID)
            self.assertNotIn(str(Path(directory)), output_path.read_text())

    def test_verify_cli_detects_tampering_and_accepts_original_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "safe.zip"
            output_path = Path(directory) / "review.json"
            with zipfile.ZipFile(archive_path, "w") as archive:
                safe_entry = zipfile.ZipInfo("safe.txt")
                safe_entry.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(safe_entry, "review metadata only")

            create_process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    str(archive_path),
                    "--output",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )
            self.assertEqual(create_process.returncode, 0)
            self.assertEqual(verify_retained_report(output_path), (True, "integrity_valid"))

            verify_process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    "--verify",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )
            self.assertEqual(verify_process.returncode, 0)
            self.assertEqual(verify_process.stdout, "integrity_valid\n")

            retained = json.loads(output_path.read_text(encoding="utf-8"))
            retained["summary"]["review_ready"] = False
            output_path.write_text(json.dumps(retained), encoding="utf-8")
            self.assertEqual(
                verify_retained_report(output_path),
                (False, "integrity_mismatch"),
            )

            tampered_process = subprocess.run(
                [
                    sys.executable,
                    str(REPOSITORY_ROOT / "scripts" / "zip_asset_inventory.py"),
                    "--verify",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": str(REPOSITORY_ROOT / "scripts")},
            )
            self.assertEqual(tampered_process.returncode, 1)
            self.assertEqual(tampered_process.stdout, "integrity_mismatch\n")
            self.assertEqual(tampered_process.stderr, "")

    def test_verify_retained_report_fails_closed_for_legacy_or_malformed_reviews(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            legacy_path = Path(directory) / "legacy.json"
            legacy_path.write_text(json.dumps({"format": "zip-asset-inventory/v1"}))
            malformed_path = Path(directory) / "malformed.json"
            malformed_path.write_text("{not-json")
            oversized_path = Path(directory) / "oversized.json"
            oversized_path.write_bytes(b" " * (MAX_RETAINED_REVIEW_BYTES + 1))

            self.assertEqual(
                verify_retained_report(legacy_path),
                (False, "integrity_mismatch"),
            )
            self.assertEqual(
                verify_retained_report(malformed_path),
                (False, "malformed_review"),
            )
            self.assertEqual(
                verify_retained_report(oversized_path),
                (False, "review_too_large"),
            )

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
