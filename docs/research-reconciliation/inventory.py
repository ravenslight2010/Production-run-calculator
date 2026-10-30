"""Regenerate the metadata-only research catalog; never execute source material.

Run from the repository root:
python3 docs/research-reconciliation/inventory.py > docs/research-reconciliation/inventory.json
The output is an intentional maintained research record, not a runtime artifact.
"""
import collections
from datetime import date
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/research-reconciliation"
DOMAINS = {
    "01-run-math": r"calc|production.rule|capacity|run.setup|unit",
    "02-sync-tracking": r"sync|track|wake|live.state|station|pause|drain",
    "03-import-master-data": r"import|recipe|premix|cheese|spec|workbook|source.library|master.data|alias",
    "04-inventory": r"inventory|stock|warehouse|surplus|freezer|prep|consum",
    "05-planning-reporting": r"schedul|break|timeline|forecast|suggest|downtime|stoppage|report|notif|push",
    "06-qc-allergen": r"qc|allergen|brix|label|date.code|quality",
    "07-ux-pwa": r"responsive|phone|tablet|accessibility|pwa|offline|navigation|floor|battery",
    "08-security": r"security|privacy|auth|account|role|capabilit|sandbox|audit|ci.",
    "09-ai": r"\bai\b|gemini|model|qlora|distill|knowledge|gold|ocr|ollama",
    "10-architecture": r"architect|decompos|boundary|modul|performance|bundle|database|pool",
    "11-verification-operations": r"test|evidence|verif|release|publish|deploy|migration|recovery|runtime|node|typescript",
    "12-maintenance": r"skill|agent|task|roadmap|research|plan|backlog|reconcil|branch|merge",
}


def digest(path):
    # Metadata discovery does not need to read very large archives or workbooks.
    if path.stat().st_size > 10 * 1024 * 1024:
        return None
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def worktree_identity():
    """Bind the catalog to HEAD plus its current tracked and untracked changes."""
    excluded = ":(exclude)docs/research-reconciliation/inventory.json"
    tracked_diff = subprocess.check_output(
        ["git", "diff", "--no-ext-diff", "--binary", "HEAD", "--", ".", excluded],
        cwd=ROOT,
    )
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    ).split(b"\0")
    paths = sorted(
        path.decode("utf-8", errors="surrogateescape")
        for path in untracked
        if path and path.decode("utf-8", errors="surrogateescape")
        != "docs/research-reconciliation/inventory.json"
    )
    fingerprint = hashlib.sha256()
    fingerprint.update(b"tracked-diff\0")
    fingerprint.update(tracked_diff)
    for relative in paths:
        fingerprint.update(b"\0untracked\0")
        fingerprint.update(relative.encode("utf-8", errors="surrogateescape"))
        fingerprint.update(b"\0")
        fingerprint.update((ROOT / relative).read_bytes())
    status = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", ".", excluded],
        cwd=ROOT,
        text=True,
    )
    return {
        "worktreeDirty": bool(status.strip()),
        "worktreeChangedFileCount": len(status.splitlines()),
        "worktreePatchSha256": fingerprint.hexdigest(),
    }


def main():
    paths = set()
    for directory in ("docs", "research", ".local/tasks"):
        paths.update((ROOT / directory).rglob("*.md"))
    paths.update(p for p in (ROOT / "attached_assets").rglob("*") if p.is_file())
    paths.update((ROOT / "artifacts/run-calculator/docs").rglob("*.md"))
    paths.update((ROOT / ".agents/memory").glob("*.md"))
    paths.update(ROOT / p for p in ("AGENTS.md", "replit.md", "README.md"))
    records = []
    for path in sorted(paths):
        if not path.is_file() or OUT in path.parents or path.is_symlink():
            continue
        rel = path.relative_to(ROOT).as_posix()
        # Only headings are retained, never workbook rows, DOCX text or payloads.
        title = path.stem
        if path.suffix.lower() == ".md":
            with path.open(errors="replace") as source:
                for _ in range(24):
                    line = source.readline()
                    if line.startswith("# "):
                        title = line[2:].strip()[:180]
                        break
        dates = re.findall(r"20\d{2}-\d{2}-\d{2}", rel)
        family = re.sub(r"_\d{10,}$", "", path.stem.lower())
        family = re.sub(r"20\d{2}-\d{2}-\d{2}", "{date}", family)
        text = rel.lower().replace("_", "-")
        origin = rel.split("/")[0]
        if rel.startswith(".local/tasks/"):
            origin = "local-plan-not-live-task-record"
        records.append({
            "path": rel, "title": title, "origin": origin,
            "dateHint": dates[-1] if dates else None,
            "bytes": path.stat().st_size, "sha256": digest(path),
            "familyCandidate": family,
            "domains": [d for d, pattern in DOMAINS.items() if re.search(pattern, text)],
        })
    hashes = collections.defaultdict(list)
    families = collections.defaultdict(list)
    for row in records:
        if row["sha256"]:
            hashes[row["sha256"]].append(row["path"])
        families[row["familyCandidate"]].append(row["path"])
    result = {
        "schemaVersion": 1, "accessDate": date.today().isoformat(),
        "sourceRevision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        **worktree_identity(),
        "method": "Local metadata inventory, not an exhaustive content or authorization review. "
                  "Date/family/domain fields are discovery hints. No archive extraction, "
                  "attachment execution, remote task retrieval or production access.",
        "hashLimitBytes": 10 * 1024 * 1024,
        "recordDefaults": {
            "dateAuthority": "filename hint only; inspect source for effective date",
            "approval": "unknown; filename, task plan and heading are not approval",
            "catalogClass": "unclassified local candidate unless explicitly mapped in sources.md",
            "authority": "unknown unless an accessible authoritative source is explicitly identified",
            "decisionDisposition": "unresolved unless explicitly assessed in sources.md or the current audit",
            "review": "metadata-only unless explicitly assessed in sources.md or matrix.md",
            "supersession": "unresolved unless explicitly assessed in sources.md",
        },
        "recordCount": len(records),
        "countsByOrigin": dict(collections.Counter(r["origin"] for r in records)),
        "exactDuplicateGroups": [v for v in hashes.values() if len(v) > 1],
        "familyCandidates": {k: v for k, v in families.items() if len(v) > 1},
        "records": records,
    }
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
