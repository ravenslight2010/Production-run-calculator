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
INTEGRITY_FIELD = "integrity"
INTEGRITY_ALGORITHM = "sha256"
INTEGRITY_SCOPE = "report-excluding-integrity"
ENVIRONMENT_CLASSES = frozenset(
    {"development", "isolated-test", "staging", "production", "unknown"}
)

# NFC preserves the spelling users generally expect while treating canonically
# equivalent member names as the same path during safety checks.
ZIP_MEMBER_UNICODE_NORMALIZATION = "NFC"

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
    if set(integrity) != {"algorithm", "scope", "sha256"}:
        return False
    stored_digest = integrity.get("sha256")
    if (
        integrity.get("algorithm") != INTEGRITY_ALGORITHM
        or integrity.get("scope") != INTEGRITY_SCOPE
        or not isinstance(stored_digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", stored_digest)
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
            result["case_fold_collision_count"] = sum(
                1 for names in casefold_names.values() if len(names) > 1
            )
            result["encrypted_entry_count"] = encrypted
            result["special_file_count"] = special_files
            result["symlink_count"] = symlinks
            result["credential_like_path_count"] = credential_paths
            result["expanded_size_limit_exceeded"] = expanded_size > max_expanded_bytes
            result["entry_size_limit_exceeded"] = largest_entry > max_entry_bytes
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
        "format": "zip-asset-inventory/v1",
        "label": "REVIEW EVIDENCE ONLY — NOT INSTALLATION APPROVAL",
        "provenance": build_provenance(),
        "read_only": True,
        "member_data_opened": False,
        "member_name_unicode_normalization": ZIP_MEMBER_UNICODE_NORMALIZATION,
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
    if args.verify:
        if args.paths or args.output or args.format != "json":
            parser.error("--verify cannot be combined with paths, --output, or --format text")
        valid, status = verify_retained_report(args.verify)
        print(status)
        return 0 if valid else 1
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