import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import reporter, { failureAnnotation } from './ci-test-reporter.mjs';

test('synthetic CI annotations escape commands and bound diagnostic length', () => {
  const output = failureAnnotation({ name: 'name\n::warning::injection', details: { error: {
    cause: { message: '100%\r\n::error::not a second command\0' + 'x'.repeat(9000) },
  } } });
  assert(output.startsWith('::error title=Self-host synthetic contract::name%0A'));
  assert(output.includes('100%25%0D%0A'));
  assert.equal(output.split('\n').length, 2);
  assert(!output.includes('\0'));
  assert(output.length < 2000);
});
test('reporter emits only test failures and handles absent details', async () => {
  const events = [{ type: 'test:pass', data: { name: 'pass' } },
    { type: 'test:fail', data: { name: 'failure' } }];
  const lines = [];
  for await (const line of reporter(events)) lines.push(line);
  assert.deepEqual(lines, ['::error title=Self-host synthetic contract::failure: test failed\n']);
});
test('custom reporter preserves the failing Node exit and names the real synthetic assertion', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'ci-reporter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'failure.test.mjs');
  writeFileSync(file, "import{test}from'node:test';test('synthetic diagnostic',()=>{throw new Error('bounded synthetic assertion')});\n");
  const result = spawnSync(process.execPath, ['--test',
    `--test-reporter=${fileURLToPath(new URL('./ci-test-reporter.mjs', import.meta.url))}`, file],
  { encoding: 'utf8', timeout: 15000,
    // A nested CLI must not inherit the parent runner's NODE_TEST_CONTEXT,
    // NODE_OPTIONS, credentials or provider configuration.
    env: Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
  });
  assert.equal(result.status, 1);
  assert(result.stdout.includes('::error title=Self-host synthetic contract::synthetic diagnostic: bounded synthetic assertion'));
});
