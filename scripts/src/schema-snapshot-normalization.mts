/**
 * PostgreSQL 16.10+ emits random \restrict / \unrestrict session guards in
 * plain-text dumps. They are pg_dump transport boilerplate, not schema.
 */
export function normalizeSchemaSnapshot(snapshot: string): string {
  return snapshot
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\\(?:un)?restrict(?:\s|$)/.test(line))
    .join("\n")
    .trimEnd()
    .concat("\n");
}