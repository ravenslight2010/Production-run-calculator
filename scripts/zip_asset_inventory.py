#!/usr/bin/env python3
"""Read-only ZIP inventory for uploaded assets.

This module deliberately inspects only ZIP headers and the central directory.
It never extracts or opens a member, and it never executes archive content.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping, Sequence


DEFAULT_MAX_ENTRIES = 100_000
DEFAULT_MAX_ENTRY_BYTES = 256 * 1024 * 1024
DEFAULT_MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_RETAINED_REVIEW_BYTES = 16 * 1024 * 1024
COMMAND_ID = "scripts/zip_asset_inventory.py"
REPORT_FORMAT = "zip-asset-inventory/v1"
REVIEW_LABEL = "REVIEW EVIDENCE ONLY — NOT INSTALLATION APPROVAL"
INTEGRITY_FIELD = "integrity"
INTEGRITY_ALGORITHM = "sha256"
INTEGRITY_SCOPE = "report-excluding-integrity"
ENVIRONMENT_CLASSES = frozenset(
    {"development", "isolated-test", "staging", "production", "unknown"}
)
PROVENANCE_CAPTURED_AT_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
)
REVISION_RE = re.compile(r"^(?:unknown|[0-9a-f]{7,64})$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ERROR_CODES = frozenset(
    {
        "source_is_symlink",
        "source_not_regular_file",
        "malformed_zip",
        "unreadable_archive",
    }
)
ARCHIVE_STATUSES = frozenset({"error", "unsafe-metadata", "review-only"})

REPORT_KEYS = frozenset(
    {
        "format",
        "label",
        "provenance",
        "read_only",
        "member_data_opened",
        "member_name_unicode_normalization",
        "limits",
        "archives",
        "summary",
        INTEGRITY_FIELD,
    }
)
PROVENANCE_KEYS = frozenset({"captured_at", "environment", "command", "revision"})
INTEGRITY_KEYS = frozenset({"algorithm", "scope", "sha256"})
LIMIT_KEYS = frozenset(
    {"max_entries", "max_entry_bytes", "max_expanded_bytes"}
)
ARCHIVE_KEYS = frozenset(
    {
        "filename",
        "sha256",
        "archive_size_bytes",
        "entry_count",
        "file_entry_count",
        "directory_entry_count",
        "expanded_size_bytes",
        "largest_entry_bytes",
        "unsafe_path_count",
        "duplicate_normalized_path_count",
        "unicode_normalization_collision_count",
        "case_fold_collision_count",
        "encrypted_entry_count",
        "special_file_count",
        "symlink_count",
        "credential_like_path_count",
        "entry_limit_exceeded",
        "expanded_size_limit_exceeded",
        "entry_size_limit_exceeded",
        "archive_duplicate",
        "unsafe_metadata",
        "status",
        "error_codes",
    }
)
SUMMARY_KEYS = frozenset(
    {
        "archive_count",
        "unsafe_archive_count",
        "duplicate_archive_group_count",
        "duplicate_archive_count",
        "review_ready",
    }
)

# NFC preserves the spelling users generally expect while treating canonically
# equivalent member names as the same path during safety checks.
ZIP_MEMBER_UNICODE_NORMALIZATION = "NFC"

# This is deliberately a small, review-only policy rather than a general
# Unicode confusables implementation.  It covers characters that are commonly
# substituted for ASCII letters in filenames and keeps the policy bounded and
# auditable.  A name containing one of these characters is ambiguous even when
# no second member produces the same skeleton.
ZIP_MEMBER_UNICODE_CONFUSABLE_POLICY = "high-risk-skeleton-v1"
ZIP_MEMBER_UNICODE_CONFUSABLE_TRANSLATIONS: dict[int, str] = str.maketrans(
    {
        # Cyrillic look-alikes.
        "а": "a",
        "е": "e",
        "о": "o",
        "р": "p",
        "с": "c",
        "х": "x",
        "у": "y",
        "і": "i",
        "ј": "j",
        "к": "k",
        "м": "m",
        "т": "t",
        "в": "b",
        "н": "h",
        "һ": "h",
        # Greek look-alikes.
        "α": "a",
        "β": "b",
        "ε": "e",
        "ι": "i",
        "κ": "k",
        "ν": "v",
        "ο": "o",
        "ρ": "p",
        "τ": "t",
        "υ": "y",
        "χ": "x",
        "ϲ": "c",
        # Letter-like symbols frequently used in place of ASCII.
        "ℓ": "l",
        "℮": "e",
    }
)

# This is intentionally a path-only check. It does not inspect member content,
# and its output is always a count rather than the matching path.
CREDENTIAL_LIKE_PATH_RE = re.compile(
    r"(^|[/\\])"
    r"(?:"
    r"\.env(?:\.[^/\\]*)?"
    r"|(?:id|ssh)[_-]?(?:rsa|dsa|ecdsa|ed25519)"
    r"|(?:private|secret|credential|token|password|passwd|api[_-]?key|access[_-]?key|auth[_-]?token|cookie)"
    r")"
    r"(?:[/\\]|$)",
    re.IGNORECASE,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_report_bytes(report: Mapping[str, object]) -> bytes:
    """Serialize every report field except the integrity envelope deterministically."""

    payload = {
        key: value for key, value in report.items() if key != INTEGRITY_FIELD
    }
    return json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def report_integrity_sha256(report: Mapping[str, object]) -> str:
    """Hash the complete report without recursively hashing its own digest."""

    return hashlib.sha256(_canonical_report_bytes(report)).hexdigest()


def add_report_integrity(report: dict[str, object]) -> dict[str, object]:
    """Attach bounded, secret-free change-detection metadata to a report."""

    report[INTEGRITY_FIELD] = {
        "algorithm": INTEGRITY_ALGORITHM,
        "scope": INTEGRITY_SCOPE,
        "sha256": report_integrity_sha256(report),
    }
    return report


def verify_report_integrity(report: Mapping[str, object]) -> bool:
    """Return whether a retained report has valid, supported integrity metadata."""

    integrity = report.get(INTEGRITY_FIELD)
    if not isinstance(integrity, Mapping):
        return False
    if set(integrity) != INTEGRITY_KEYS:
        return False
    stored_digest = integrity.get("sha256")
    if (
        integrity.get("algorithm") != INTEGRITY_ALGORITHM
        or integrity.get("scope") != INTEGRITY_SCOPE
        or not isinstance(stored_digest, str)
        or not SHA256_RE.fullmatch(stored_digest)
    ):
        return False
    return hmac.compare_digest(stored_digest, report_integrity_sha256(report))


def _load_retained_report(path: Path) -> tuple[dict[str, object] | None, str]:
    """Load a bounded retained report without exposing parser or filesystem details."""

    try:
        if path.is_symlink() or not path.is_file():
            return None, "unreadable_review"
        with path.open("rb") as source:
            raw_report = source.read(MAX_RETAINED_REVIEW_BYTES + 1)
        if len(raw_report) > MAX_RETAINED_REVIEW_BYTES:
            return None, "review_too_large"
        report = json.loads(raw_report.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None, "malformed_review"
    if not isinstance(report, dict):
        return None, "malformed_review"
    return report, ""


def verify_retained_report(path: Path) -> tuple[bool, str]:
    """Verify a retained JSON review and return a stable, non-sensitive result."""

    report, error = _load_retained_report(path)
    if report is None:
        return False, error
    if not verify_report_integrity(report):
        return False, "integrity_mismatch"
    return True, "integrity_valid"


def _truthy(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes"}


def classify_environment(environment: Mapping[str, str] | None = None) -> str:
    """Return a bounded environment class without copying arbitrary env values."""

    values = os.environ if environment is None else environment
    declared = values.get("ZIP_ASSET_INVENTORY_ENVIRONMENT", "").strip().lower()
    if declared in ENVIRONMENT_CLASSES - {"unknown"}:
        return declared

    # A deployment marker is stronger than the generic Replit environment label.
    # In particular, isolated workspaces can report REPLIT_ENVIRONMENT=production.
    if values.get("REPLIT_DEPLOYMENT_ID", "").strip() or _truthy(
        values.get("REPLIT_DEPLOYMENT")
    ):
        return "production"
    if _truthy(values.get("CI")) or _truthy(values.get("GITHUB_ACTIONS")):
        return "isolated-test"

    replit_environment = values.get("REPLIT_ENVIRONMENT", "").strip().lower()
    if replit_environment == "development":
        return "development"
    if replit_environment == "staging":
        return "staging"
    return "unknown"


def current_revision(repository_root: Path | None = None) -> str:
    """Return only a validated Git revision, or ``unknown`` if unavailable."""

    root = repository_root or Path(__file__).resolve().parents[1]
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"

    revision = completed.stdout.strip()
    if completed.returncode != 0 or not re.fullmatch(r"[0-9a-f]{7,64}", revision):
        return "unknown"
    return revision


def build_provenance() -> dict[str, str]:
    """Build bounded metadata for the exact scanner invocation that made a report."""

    captured_at = datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    return {
        "captured_at": captured_at,
        "environment": classify_environment(),
        "command": COMMAND_ID,
        "revision": current_revision(),
    }


def _is_int(value: object) -> bool:
    return type(value) is int


def _has_exact_keys(value: object, keys: frozenset[str]) -> bool:
    return isinstance(value, dict) and frozenset(value) == keys


def validate_review_report(report: object) -> tuple[str, ...]:
    """Return stable errors for a retained JSON report, failing closed.

    The validator intentionally accepts only the scanner's current, redacted
    schema.  In particular, it does not accept arbitrary metadata fields or
    free-form error messages that could carry paths, arguments, member names,
    or archive contents.
    """

    errors: list[str] = []
    if not _has_exact_keys(report, REPORT_KEYS):
        return ("report_schema",)
    assert isinstance(report, dict)

    if report["format"] != REPORT_FORMAT:
        errors.append("format")
    if report["label"] != REVIEW_LABEL:
        errors.append("label")
    if report["read_only"] is not True:
        errors.append("read_only")
    if report["member_data_opened"] is not False:
        errors.append("member_data_opened")
    if report["member_name_unicode_normalization"] != ZIP_MEMBER_UNICODE_NORMALIZATION:
        errors.append("unicode_normalization")

    integrity = report[INTEGRITY_FIELD]
    if not _has_exact_keys(integrity, INTEGRITY_KEYS):
        errors.append("integrity_schema")
    else:
        assert isinstance(integrity, dict)
        if integrity["algorithm"] != INTEGRITY_ALGORITHM:
            errors.append("integrity_algorithm")
        if integrity["scope"] != INTEGRITY_SCOPE:
            errors.append("integrity_scope")
        if not (
            isinstance(integrity["sha256"], str)
            and SHA256_RE.fullmatch(integrity["sha256"])
        ):
            errors.append("integrity_sha256")

    provenance = report["provenance"]
    if not _has_exact_keys(provenance, PROVENANCE_KEYS):
        errors.append("provenance_schema")
    else:
        assert isinstance(provenance, dict)
        captured_at = provenance["captured_at"]
        environment = provenance["environment"]
        command = provenance["command"]
        revision = provenance["revision"]
        if not (
            isinstance(captured_at, str)
            and len(captured_at) == 20
            and PROVENANCE_CAPTURED_AT_RE.fullmatch(captured_at)
        ):
            errors.append("provenance_captured_at")
        if not (
            isinstance(environment, str)
            and environment in ENVIRONMENT_CLASSES
            and len(environment) <= 16
        ):
            errors.append("provenance_environment")
        if command != COMMAND_ID:
            errors.append("provenance_command")
        if not (
            isinstance(revision, str)
            and len(revision) <= 64
            and REVISION_RE.fullmatch(revision)
        ):
            errors.append("provenance_revision")

    limits = report["limits"]
    if not _has_exact_keys(limits, LIMIT_KEYS):
        errors.append("limits_schema")
    else:
        assert isinstance(limits, dict)
        limit_maxima = {
            "max_entries": DEFAULT_MAX_ENTRIES,
            "max_entry_bytes": DEFAULT_MAX_ENTRY_BYTES,
            "max_expanded_bytes": DEFAULT_MAX_EXPANDED_BYTES,
        }
        for key, maximum in limit_maxima.items():
            value = limits[key]
            if not _is_int(value) or not 1 <= value <= maximum:
                errors.append(f"limit_{key}")

    archives = report["archives"]
    valid_archive_rows: list[dict[str, object]] = []
    if not isinstance(archives, list):
        errors.append("archives_schema")
    else:
        for index, archive in enumerate(archives):
            if not _has_exact_keys(archive, ARCHIVE_KEYS):
                errors.append(f"archive_{index}_schema")
                continue
            assert isinstance(archive, dict)
            valid_archive_rows.append(archive)
            filename = archive["filename"]
            if not (
                isinstance(filename, str)
                and 1 <= len(filename) <= 255
                and not any(
                    character in filename for character in ("/", "\\", "\x00", "\n", "\r")
                )
            ):
                errors.append(f"archive_{index}_filename")

            archive_hash = archive["sha256"]
            if archive_hash is not None and not (
                isinstance(archive_hash, str) and SHA256_RE.fullmatch(archive_hash)
            ):
                errors.append(f"archive_{index}_sha256")

            archive_size = archive["archive_size_bytes"]
            if archive_size is not None and (
                not _is_int(archive_size) or archive_size < 0
            ):
                errors.append(f"archive_{index}_archive_size")

            for key in (
                "entry_count",
                "file_entry_count",
                "directory_entry_count",
                "expanded_size_bytes",
                "largest_entry_bytes",
                "unsafe_path_count",
                "duplicate_normalized_path_count",
                "unicode_normalization_collision_count",
                "case_fold_collision_count",
                "encrypted_entry_count",
                "special_file_count",
                "symlink_count",
                "credential_like_path_count",
            ):
                if not _is_int(archive[key]) or archive[key] < 0:
                    errors.append(f"archive_{index}_{key}")

            for key in (
                "entry_limit_exceeded",
                "expanded_size_limit_exceeded",
                "entry_size_limit_exceeded",
                "archive_duplicate",
                "unsafe_metadata",
            ):
                if type(archive[key]) is not bool:
                    errors.append(f"archive_{index}_{key}")

            status = archive["status"]
            if not isinstance(status, str) or status not in ARCHIVE_STATUSES:
                errors.append(f"archive_{index}_status")
            error_codes = archive["error_codes"]
            if not (
                isinstance(error_codes, list)
                and all(
                    isinstance(code, str) and code in ERROR_CODES
                    for code in error_codes
                )
            ):
                errors.append(f"archive_{index}_error_codes")

    summary = report["summary"]
    if not _has_exact_keys(summary, SUMMARY_KEYS):
        errors.append("summary_schema")
    elif isinstance(archives, list) and len(valid_archive_rows) == len(archives):
        assert isinstance(summary, dict)
        for key in (
            "archive_count",
            "unsafe_archive_count",
            "duplicate_archive_group_count",
            "duplicate_archive_count",
        ):
            if not _is_int(summary[key]) or summary[key] < 0:
                errors.append(f"summary_{key}")
        if type(summary["review_ready"]) is not bool:
            errors.append("summary_review_ready")
        else:
            unsafe_count = sum(
                bool(archive["unsafe_metadata"]) for archive in valid_archive_rows
            )
            duplicate_hashes: defaultdict[str, int] = defaultdict(int)
            for archive in valid_archive_rows:
                archive_hash = archive["sha256"]
                if isinstance(archive_hash, str):
                    duplicate_hashes[archive_hash] += 1
            duplicate_groups = [
                count for count in duplicate_hashes.values() if count > 1
            ]
            duplicate_count = sum(count - 1 for count in duplicate_groups)
            if summary["archive_count"] != len(archives):
                errors.append("summary_archive_count")
            if summary["unsafe_archive_count"] != unsafe_count:
                errors.append("summary_unsafe_archive_count")
            if summary["duplicate_archive_group_count"] != len(duplicate_groups):
                errors.append("summary_duplicate_archive_group_count")
            if summary["duplicate_archive_count"] != duplicate_count:
                errors.append("summary_duplicate_archive_count")
            if summary["review_ready"] != (unsafe_count == 0):
                errors.append("summary_review_ready_value")

    if not verify_report_integrity(report):
        errors.append("integrity_mismatch")

    return tuple(dict.fromkeys(errors))


def normalized_member_path(raw_name: str) -> tuple[str, bool]:
    """Return an NFC-normalized, host-independent path key and its safety."""

    name = unicodedata.normalize(ZIP_MEMBER_UNICODE_NORMALIZATION, raw_name).replace(
        "\\", "/"
    )
    parts = name.split("/")
    unsafe = (
        "\x00" in name
        or name.startswith("/")
        or bool(re.match(r"^[A-Za-z]:/", name))
        or any(part == ".." for part in parts)
    )
    normalized_parts = [part for part in parts if part not in ("", ".")]
    return "/".join(normalized_parts) or ".", unsafe

def confusable_skeleton(normalized_name: str) -> tuple[str, bool]:
    """Return a bounded confusable skeleton and whether it is ambiguous."""

    folded = normalized_name.casefold()
    skeleton = folded.translate(ZIP_MEMBER_UNICODE_CONFUSABLE_TRANSLATIONS)
    return skeleton, skeleton != folded
def is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return stat.S_ISLNK(mode)


def is_special_file(info: zipfile.ZipInfo) -> bool:
    if info.is_dir():
        return False
    mode = (info.external_attr >> 16) & 0xFFFF
    if not mode:
        return False
    return not stat.S_ISREG(mode)


def _empty_archive_result(filename: str) -> dict[str, object]:
    return {
        "filename": filename,
        "sha256": None,
        "archive_size_bytes": None,
        "entry_count": 0,
        "file_entry_count": 0,
        "directory_entry_count": 0,
        "expanded_size_bytes": 0,
        "largest_entry_bytes": 0,
        "unsafe_path_count": 0,
        "duplicate_normalized_path_count": 0,
        "unicode_normalization_collision_count": 0,
        "unicode_confusable_ambiguity_count": 0,
        "unicode_confusable_collision_count": 0,
        "case_fold_collision_count": 0,
        "encrypted_entry_count": 0,
        "special_file_count": 0,
        "symlink_count": 0,
        "credential_like_path_count": 0,
        "entry_limit_exceeded": False,
        "expanded_size_limit_exceeded": False,
        "entry_size_limit_exceeded": False,
        "archive_duplicate": False,
        "unsafe_metadata": True,
        "status": "error",
        "error_codes": [],
    }


def inspect_archive(
    path: Path,
    *,
    max_entries: int = DEFAULT_MAX_ENTRIES,
    max_entry_bytes: int = DEFAULT_MAX_ENTRY_BYTES,
    max_expanded_bytes: int = DEFAULT_MAX_EXPANDED_BYTES,
) -> dict[str, object]:
    """Inspect one archive without reading any member data."""

    result = _empty_archive_result(path.name)
    errors: list[str] = []

    if path.is_symlink():
        errors.append("source_is_symlink")
        result["error_codes"] = errors
        return result
    if not path.is_file():
        errors.append("source_not_regular_file")
        result["error_codes"] = errors
        return result

    try:
        result["sha256"] = sha256_file(path)
        result["archive_size_bytes"] = path.stat().st_size
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            result["entry_count"] = len(infos)
            result["entry_limit_exceeded"] = len(infos) > max_entries

            normalized_counts: defaultdict[str, int] = defaultdict(int)
            unicode_name_variants: defaultdict[str, set[str]] = defaultdict(set)
            confusable_skeleton_names: defaultdict[str, set[str]] = defaultdict(set)
            confusable_names: set[str] = set()
            casefold_names: defaultdict[str, set[str]] = defaultdict(set)
            expanded_size = 0
            largest_entry = 0
            file_count = 0
            directory_count = 0
            unsafe_paths = 0
            encrypted = 0
            special_files = 0
            symlinks = 0
            credential_paths = 0

            for info in infos:
                normalized, unsafe = normalized_member_path(info.filename)
                normalized_counts[normalized] += 1
                nfc_name = unicodedata.normalize(
                    ZIP_MEMBER_UNICODE_NORMALIZATION, info.filename
                )
                unicode_name_variants[nfc_name].add(info.filename)
                skeleton, ambiguous = confusable_skeleton(normalized)
                confusable_skeleton_names[skeleton].add(normalized)
                if ambiguous:
                    confusable_names.add(normalized)
                casefold_names[
                    unicodedata.normalize(
                        ZIP_MEMBER_UNICODE_NORMALIZATION, normalized.casefold()
                    )
                ].add(normalized)
                unsafe_paths += int(unsafe)

                if info.is_dir():
                    directory_count += 1
                else:
                    file_count += 1
                if info.flag_bits & 0x1:
                    encrypted += 1
                if is_symlink(info):
                    symlinks += 1
                if is_special_file(info):
                    special_files += 1
                if CREDENTIAL_LIKE_PATH_RE.search(info.filename):
                    credential_paths += 1

                expanded_size += info.file_size
                largest_entry = max(largest_entry, info.file_size)

            result["file_entry_count"] = file_count
            result["directory_entry_count"] = directory_count
            result["expanded_size_bytes"] = expanded_size
            result["largest_entry_bytes"] = largest_entry
            result["unsafe_path_count"] = unsafe_paths
            result["duplicate_normalized_path_count"] = sum(
                count - 1 for count in normalized_counts.values() if count > 1
            )
            result["unicode_normalization_collision_count"] = sum(
                len(names) - 1
                for names in unicode_name_variants.values()
                if len(names) > 1
            )
            result["unicode_confusable_ambiguity_count"] = len(confusable_names)
            result["unicode_confusable_collision_count"] = sum(
                len(names) - 1
                for names in confusable_skeleton_names.values()
                if len(names) > 1
            )
            result["case_fold_collision_count"] = sum(
                1 for names in casefold_names.values() if len(names) > 1
            )
            result["encrypted_entry_count"] = encrypted
            result["special_file_count"] = special_files
            result["symlink_count"] = symlinks
            result["credential_like_path_count"] = credential_paths
            result["expanded_size_limit_exceeded"] = expanded_size > max_expanded_bytes
            result["entry_size_limit_exceeded"] = largest_entry > max_entry_bytes
    except UnicodeDecodeError:
        # ZIP filename decoding happens while the central directory is parsed.
        # Keep malformed names out of review evidence and use a stable,
        # metadata-only error code instead of exposing the parser detail.
        errors.append("malformed_filename_encoding")
    except zipfile.BadZipFile:
        errors.append("malformed_zip")
    except (OSError, RuntimeError, ValueError):
        # Do not surface filesystem or parser details: they can contain local
        # paths or member names and are not needed for review evidence.
        errors.append("unreadable_archive")

    result["error_codes"] = errors
    result["unsafe_metadata"] = bool(
        errors
        or result["entry_limit_exceeded"]
        or result["expanded_size_limit_exceeded"]
        or result["entry_size_limit_exceeded"]
        or result["unsafe_path_count"]
        or result["duplicate_normalized_path_count"]
        or result["unicode_normalization_collision_count"]
        or result["unicode_confusable_ambiguity_count"]
        or result["unicode_confusable_collision_count"]
        or result["case_fold_collision_count"]
        or result["encrypted_entry_count"]
        or result["special_file_count"]
    )
    if errors:
        result["status"] = "error"
    elif result["unsafe_metadata"]:
        result["status"] = "unsafe-metadata"
    else:
        result["status"] = "review-only"
    return result


def discover_archives(inputs: Iterable[Path]) -> list[Path]:
    archives: list[Path] = []
    for source in inputs:
        if source.is_dir():
            archives.extend(
                candidate
                for candidate in source.rglob("*.zip")
                if candidate.is_file() or candidate.is_symlink()
            )
        else:
            archives.append(source)
    return sorted(set(archives), key=lambda candidate: str(candidate))


def inventory_archives(
    paths: Sequence[Path],
    *,
    max_entries: int = DEFAULT_MAX_ENTRIES,
    max_entry_bytes: int = DEFAULT_MAX_ENTRY_BYTES,
    max_expanded_bytes: int = DEFAULT_MAX_EXPANDED_BYTES,
) -> dict[str, object]:
    paths = discover_archives(paths)
    archives = [
        inspect_archive(
            path,
            max_entries=max_entries,
            max_entry_bytes=max_entry_bytes,
            max_expanded_bytes=max_expanded_bytes,
        )
        for path in paths
    ]

    by_hash: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
    for archive in archives:
        archive_hash = archive["sha256"]
        if isinstance(archive_hash, str):
            by_hash[archive_hash].append(archive)
    duplicate_groups = [group for group in by_hash.values() if len(group) > 1]
    for group in duplicate_groups:
        for archive in group:
            archive["archive_duplicate"] = True

    unsafe_count = sum(bool(archive["unsafe_metadata"]) for archive in archives)
    duplicate_archive_count = sum(len(group) - 1 for group in duplicate_groups)
    return add_report_integrity({
        "format": REPORT_FORMAT,
        "label": REVIEW_LABEL,
        "provenance": build_provenance(),
        "read_only": True,
        "member_data_opened": False,
        "member_name_unicode_normalization": ZIP_MEMBER_UNICODE_NORMALIZATION,
        "member_name_unicode_confusable_policy": ZIP_MEMBER_UNICODE_CONFUSABLE_POLICY,
        "limits": {
            "max_entries": max_entries,
            "max_entry_bytes": max_entry_bytes,
            "max_expanded_bytes": max_expanded_bytes,
        },
        "archives": archives,
        "summary": {
            "archive_count": len(archives),
            "unsafe_archive_count": unsafe_count,
            "duplicate_archive_group_count": len(duplicate_groups),
            "duplicate_archive_count": duplicate_archive_count,
            "review_ready": unsafe_count == 0,
        },
    })


def _parser() -> argparse.ArgumentParser:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description=(
            "Inventory ZIP central-directory metadata without extracting or "
            "executing archive contents."
        )
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="ZIP files or directories to scan (default: attached_assets)",
    )
    parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="report format (default: json)",
    )
    parser.add_argument("--max-entries", type=int, default=DEFAULT_MAX_ENTRIES)
    parser.add_argument("--max-entry-bytes", type=int, default=DEFAULT_MAX_ENTRY_BYTES)
    parser.add_argument(
        "--max-expanded-bytes",
        type=int,
        default=DEFAULT_MAX_EXPANDED_BYTES,
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="write the JSON review evidence to this file instead of stdout",
    )
    parser.add_argument(
        "--validate-report",
        type=Path,
        help="validate a retained JSON review report without reading archive members",
    )
    parser.add_argument(
        "--verify",
        type=Path,
        metavar="REVIEW_JSON",
        help="verify the retained JSON review integrity instead of scanning ZIP files",
    )
    parser.set_defaults(default_root=repository_root / "attached_assets")
    return parser


def _text_report(report: dict[str, object]) -> str:
    lines = [
        str(report["label"]),
        "read_only=true member_data_opened=false",
        json.dumps(report["limits"], sort_keys=True),
    ]
    for archive in report["archives"]:
        lines.append(
            " ".join(
                [
                    f"filename={archive['filename']}",
                    f"sha256={archive['sha256'] or 'unavailable'}",
                    f"entries={archive['entry_count']}",
                    f"expanded_bytes={archive['expanded_size_bytes']}",
                    f"unsafe_paths={archive['unsafe_path_count']}",
                    f"duplicate_paths={archive['duplicate_normalized_path_count']}",
                    f"unicode_normalization_collisions={archive['unicode_normalization_collision_count']}",
                    f"unicode_confusable_ambiguities={archive['unicode_confusable_ambiguity_count']}",
                    f"unicode_confusable_collisions={archive['unicode_confusable_collision_count']}",
                    f"case_fold_collisions={archive['case_fold_collision_count']}",
                    f"encrypted={archive['encrypted_entry_count']}",
                    f"special_files={archive['special_file_count']}",
                    f"symlinks={archive['symlink_count']}",
                    f"credential_like_paths={archive['credential_like_path_count']}",
                    f"archive_duplicate={str(archive['archive_duplicate']).lower()}",
                    f"status={archive['status']}",
                ]
            )
        )
    lines.append(json.dumps(report["summary"], sort_keys=True))
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.verify is not None:
        if args.paths or args.output or args.format != "json" or args.validate_report:
            parser.error(
                "--verify cannot be combined with paths, --output, --format text, "
                "or --validate-report"
            )
        valid, status = verify_retained_report(args.verify)
        print(status)
        return 0 if valid else 1
    if args.validate_report is not None:
        if args.paths or args.output or args.format != "json":
            parser.error("--validate-report cannot be combined with archive inputs, --output, or --format text")
        report, load_error = _load_retained_report(args.validate_report)
        if report is None:
            print(json.dumps({"valid": False, "errors": [load_error]}))
            return 1
        errors = validate_review_report(report)
        print(json.dumps({"valid": not errors, "errors": list(errors)}))
        return 0 if not errors else 1

    if min(args.max_entries, args.max_entry_bytes, args.max_expanded_bytes) < 1:
        parser.error("all limits must be positive")

    inputs = args.paths or [args.default_root]
    paths = discover_archives(inputs)
    if not paths:
        parser.error("no ZIP archives found")
    report = inventory_archives(
        paths,
        max_entries=args.max_entries,
        max_entry_bytes=args.max_entry_bytes,
        max_expanded_bytes=args.max_expanded_bytes,
    )
    if args.format == "json":
        rendered = f"{json.dumps(report, indent=2, sort_keys=True)}\n"
        if args.output:
            try:
                args.output.write_text(rendered, encoding="utf-8")
            except OSError:
                parser.error("unable to write JSON review evidence")
        else:
            print(rendered, end="")
    else:
        if args.output:
            parser.error("--output is only supported with --format json")
        print(_text_report(report))

    return 1 if report["summary"]["unsafe_archive_count"] else 0


if __name__ == "__main__":
    sys.exit(main())
