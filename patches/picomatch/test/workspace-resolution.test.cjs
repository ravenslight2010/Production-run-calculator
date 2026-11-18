'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');

test('every active picomatch consumer resolves the maintained workspace source', t => {
  const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.match(workspace, /^\s+- patches\/picomatch$/m);
  assert.match(workspace, /^\s+picomatch: "workspace:\*"$/m);
  assert.doesNotMatch(lock, /picomatch@file:|picomatch:\s*file:/);
  assert.doesNotMatch(lock, /^\s+picomatch@[\d]/m);

  const source = fs.realpathSync(path.join(root, 'patches/picomatch/index.js'));
  // Traverse from lockfile importers, not every virtual-store directory:
  // pnpm can retain unreachable packages from previous installations.
  const pending = [];
  let importers = false;
  for (const line of lock.split('\n')) {
    if (/^\S/.test(line)) importers = line === 'importers:';
    const match = importers && line.match(/^  ([^:]+):(?: \{\})?$/);
    if (match) pending.push(path.join(root, match[1], 'node_modules'));
  }
  const seenModules = new Set();
  const seenPackages = new Set();
  let consumers = 0;
  while (pending.length > 0) {
    const modules = pending.pop();
    if (!fs.existsSync(modules)) continue;
    const resolvedModules = fs.realpathSync(modules);
    if (seenModules.has(resolvedModules)) continue;
    seenModules.add(resolvedModules);
    const packages = fs.readdirSync(modules).filter(name => !name.startsWith('.'))
      .flatMap(name => name.startsWith('@')
        ? fs.readdirSync(path.join(modules, name)).map(child => path.join(name, child))
        : [name]);
    for (const name of packages) {
      const packageRoot = fs.realpathSync(path.join(modules, name));
      if (seenPackages.has(packageRoot)) continue;
      seenPackages.add(packageRoot);
      const manifestPath = path.join(packageRoot, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      pending.push(path.join(packageRoot, 'node_modules'));
      let containingModules = path.dirname(packageRoot);
      if (path.basename(containingModules).startsWith('@')) containingModules = path.dirname(containingModules);
      if (path.basename(containingModules) === 'node_modules') pending.push(containingModules);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest.dependencies?.picomatch && !manifest.peerDependencies?.picomatch) continue;
      const consumerRequire = createRequire(manifestPath);
      assert.equal(fs.realpathSync(consumerRequire.resolve('picomatch')), source, `${manifest.name} must use the security fork`);
      consumers++;
    }
  }
  assert.ok(consumers > 0, 'must check real installed consumers, not only configuration');
  t.diagnostic(`Verified ${consumers} active consumer manifests resolve the maintained source`);
});
