#!/usr/bin/env python3
"""Dependency-free quick validation for a single skill directory."""

import re
import sys
from pathlib import Path


SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_SKILL_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_EDITABLE_LINES = 500


def _unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _parse_frontmatter(lines, closing_line):
    """Parse the deliberately small YAML subset supported by the catalog."""
    fields = {}
    index = 1
    while index < closing_line:
        line = lines[index]
        if not line.strip():
            index += 1
            continue

        match = re.fullmatch(r"([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)", line)
        if not match:
            return None, f"Invalid frontmatter (line {index + 1})"

        key, raw_value = match.groups()
        if key in fields:
            return None, f"Duplicate frontmatter field '{key}' (line {index + 1})"

        if raw_value in {">", "|"}:
            continuation = []
            index += 1
            while index < closing_line:
                continuation_line = lines[index]
                if continuation_line.strip() and not re.match(r"^[ \t]+", continuation_line):
                    break
                continuation.append(continuation_line.strip())
                index += 1
            separator = " " if raw_value == ">" else "\n"
            fields[key] = separator.join(continuation).strip()
            continue

        fields[key] = _unquote(raw_value)
        index += 1

    return fields, None


def validate_skill(skill_path):
    """Validate one skill using the repository catalog's metadata rules."""
    skill_md = Path(skill_path) / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    try:
        content = skill_md.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        return False, f"Could not read SKILL.md: {error}"

    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return False, "No YAML frontmatter found"

    closing_line = next(
        (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
        None,
    )
    if closing_line is None:
        return False, "Invalid frontmatter format"

    frontmatter, error = _parse_frontmatter(lines, closing_line)
    if error:
        return False, error

    name = frontmatter.get("name", "").strip()
    if not name:
        return False, "Missing 'name' in frontmatter"
    description = frontmatter.get("description", "").strip()
    if not description:
        return False, "Missing 'description' in frontmatter"

    if len(name) > MAX_SKILL_NAME_LENGTH:
        return False, (
            f"Name is too long ({len(name)} characters). "
            f"Maximum is {MAX_SKILL_NAME_LENGTH} characters."
        )
    if not SKILL_NAME_PATTERN.fullmatch(name):
        return False, (
            f"Name '{name}' must use lowercase letters and digits "
            "separated by single hyphens"
        )
    directory_name = Path(skill_path).resolve().name
    if name != directory_name:
        return False, (
            f"Name '{name}' must match skill directory '{directory_name}'"
        )
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return False, (
            f"Description is too long ({len(description)} characters). "
            f"Maximum is {MAX_DESCRIPTION_LENGTH} characters."
        )
    if len(lines) > MAX_EDITABLE_LINES:
        return False, f"SKILL.md exceeds the {MAX_EDITABLE_LINES}-line limit"

    return True, "Skill is valid!"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)