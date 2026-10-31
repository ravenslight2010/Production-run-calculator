"""Compare Docker's inspect representation without weakening the capability set."""
import json
import sys


def capability_list(value, *, normalize_prefix=False, allow_null=False):
    values = json.loads(value)
    if values is None and allow_null:
        return []
    if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
        raise ValueError("Capabilities must be a list")
    normalized = [item.removeprefix("CAP_") if normalize_prefix else item for item in values]
    if len(set(normalized)) != len(normalized):
        raise ValueError("Duplicate capabilities")
    return sorted(normalized)


def matches(actual, expected_user, expected_drop, expected_add):
    try:
        user, dropped, added = actual.split("|")
        return (
            user == expected_user
            and capability_list(dropped) == capability_list(expected_drop)
            and capability_list(added, normalize_prefix=True, allow_null=True)
            == capability_list(expected_add)
        )
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    if len(sys.argv) != 5 or not matches(sys.argv[1], *sys.argv[2:]):
        print("Container security mismatch: user or exact capability set differs.", file=sys.stderr)
        sys.exit(1)
