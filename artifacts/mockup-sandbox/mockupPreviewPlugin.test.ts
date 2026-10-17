import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverMockupFiles } from "./mockupPreviewPlugin.ts";

test("discovers nested TSX mockups and ignores hidden and private paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mockup-preview-"));
  const mockups = path.join(root, "src/components/mockups");

  try {
    await mkdir(path.join(mockups, "nested"), { recursive: true });
    await mkdir(path.join(mockups, "_private"), { recursive: true });
    await mkdir(path.join(mockups, ".hidden"), { recursive: true });
    await writeFile(path.join(mockups, "Visible.tsx"), "export default null;");
    await writeFile(
      path.join(mockups, "nested/Nested.tsx"),
      "export default null;",
    );
    await writeFile(
      path.join(mockups, "nested/_Hidden.tsx"),
      "export default null;",
    );
    await writeFile(
      path.join(mockups, "_private/Private.tsx"),
      "export default null;",
    );
    await writeFile(
      path.join(mockups, ".hidden/Hidden.tsx"),
      "export default null;",
    );
    await writeFile(path.join(mockups, "notes.ts"), "export {};");
    await writeFile(path.join(root, "Outside.tsx"), "export default null;");
    await symlink(
      path.join(root, "Outside.tsx"),
      path.join(mockups, "Linked.tsx"),
    );

    const files = await discoverMockupFiles(root);

    assert.deepEqual(files.sort(), [
      "src/components/mockups/Visible.tsx",
      "src/components/mockups/nested/Nested.tsx",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns no matches when the mockups directory has not been created", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mockup-preview-"));

  try {
    assert.deepEqual(await discoverMockupFiles(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
