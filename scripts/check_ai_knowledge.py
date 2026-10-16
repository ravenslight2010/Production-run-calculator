#!/usr/bin/env python3
"""Check source freshness for the versioned, static app-knowledge package."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_PATH = WORKSPACE_ROOT / "lib/ai-evaluation/src/appKnowledge.ts"
MANIFEST_PATH = WORKSPACE_ROOT / "docs/ai-knowledge/manifest.json"
VERSION_PATTERN = re.compile(r'APP_KNOWLEDGE_VERSION\s*=\s*"([^"]+)"')
SOURCE_PATTERN = re.compile(r'\{\s*path:\s*"([^"]+)"\s*,\s*anchor:\s*"([^"]+)"')
MANIFEST_FORMAT = "app-knowledge-source-manifest"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def build_snapshot(
    root: Path,
    knowledge_path: Path,
) -> dict[str, object]:
    try:
        content = knowledge_path.read_bytes()
    except OSError as error:
        raise ValueError("The app-knowledge source file is unavailable.") from error
    source = content.decode("utf-8")
    version_match = VERSION_PATTERN.search(source)
    if not version_match:
        raise ValueError("The app-knowledge package must declare its version.")
    source_paths = sorted({path for path, _anchor in SOURCE_PATTERN.findall(source)})
    if not source_paths:
        raise ValueError("The app-knowledge package must cite repository sources.")

    sources: list[dict[str, str]] = []
    for relative_path in source_paths:
        candidate = root / relative_path
        if not candidate.resolve().is_relative_to(root.resolve()):
            raise ValueError("A knowledge source path must remain inside the repository.")
        if candidate.is_symlink() or not candidate.is_file():
            raise ValueError(f"A referenced app-knowledge source is missing: {relative_path}")
        sources.append(
            {
                "path": relative_path,
                "sha256": sha256_bytes(candidate.read_bytes()),
            }
        )
    return {
        "format": MANIFEST_FORMAT,
        "sourceManifestVersion": 1,
        "knowledgeVersion": version_match.group(1),
        "knowledgeFileSha256": sha256_bytes(content),
        "sources": sources,
    }


def compare_snapshot(expected: object, actual: dict[str, object]) -> list[str]:
    if not isinstance(expected, dict):
        return ["manifest-invalid"]
    differences: list[str] = []
    for key in (
        "format",
        "sourceManifestVersion",
        "knowledgeVersion",
        "knowledgeFileSha256",
        "sources",
    ):
        if expected.get(key) != actual.get(key):
            differences.append(key)
    return differences


def update_manifest(
    root: Path,
    knowledge_path: Path,
    manifest_path: Path,
) -> None:
    actual = build_snapshot(root, knowledge_path)
    if manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise ValueError("The existing knowledge manifest is unreadable.") from None
        differences = compare_snapshot(previous, actual)
        if differences and isinstance(previous, dict):
            content_keys = (
                "format",
                "knowledgeVersion",
                "knowledgeFileSha256",
                "sources",
            )
            content_unchanged = all(
                previous.get(key) == actual.get(key) for key in content_keys
            )
            if (
                previous.get("knowledgeVersion") == actual["knowledgeVersion"]
                and not content_unchanged
            ):
                raise ValueError(
                    "Source or knowledge content changed without a knowledge-version bump; "
                    "review the facts, bump APP_KNOWLEDGE_VERSION, then regenerate."
                )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = manifest_path.with_name(manifest_path.name + ".tmp")
    temporary.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(manifest_path)


def check_manifest(
    root: Path,
    knowledge_path: Path,
    manifest_path: Path,
) -> list[str]:
    actual = build_snapshot(root, knowledge_path)
    try:
        expected = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ["manifest-missing"]
    except (OSError, json.JSONDecodeError):
        return ["manifest-invalid"]
    return compare_snapshot(expected, actual)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--update",
        action="store_true",
        help="Regenerate hashes after reviewed content changes and a version bump.",
    )
    group.add_argument("--check", action="store_true", help="Fail when source or package hashes are stale.")
    args = parser.parse_args(argv)
    try:
        if args.update:
            update_manifest(WORKSPACE_ROOT, KNOWLEDGE_PATH, MANIFEST_PATH)
            print("App-knowledge source manifest regenerated.")
            return 0
        differences = check_manifest(WORKSPACE_ROOT, KNOWLEDGE_PATH, MANIFEST_PATH)
        if differences:
            print(
                "App-knowledge source manifest is stale: " + ", ".join(differences),
                file=sys.stderr,
            )
            return 1
        print("App-knowledge source manifest is current.")
        return 0
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
