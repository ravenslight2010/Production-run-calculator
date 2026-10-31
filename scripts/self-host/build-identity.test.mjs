import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  fingerprintSource, isSourceInput, SELF_HOST_FRESH_SOURCE_POLICY as POLICY, verifiedGitRevision,
} from '../src/build-source-files.mjs';
import {
  buildSourceRecord, completeBuildStage, EXPECTED_RECORD_PATH, outputFingerprint,
  preparePublishSource, readBoundedJson, sealBuildIdentity, SOURCE_RECORD_PATH,
  validateBuildInfo, validateSourceRecord,
} from '../src/build-source-identity.mjs';
import { SOURCE_LIBRARY_POOL_APPROVAL_ASSETS } from '../src/source-library-pool-approval-assets.mjs';
import { verifyPublishedBuild, createPublishedSourceHandoff } from '../src/verify-published-build.mjs';
import { assessmentRevision } from '../src/release-source-identity.mjs';
import { outputs, put, sourceFixture } from '../src/fixtures/build-identity-fixture.mjs';
import {
  assertFreshSourceUnchanged, completeFreshBuildStage, createFreshSourceRecord,
  FRESH_EXPECTED_RECORD_PATH, FRESH_SOURCE_RECORD_PATH, freshBuildInfoFromRecord,
  freshSourceRecordDigest, prepareFreshSource, sealFreshBuildIdentity,
  validateFreshBuildInfo, validateFreshSourceRecord,
} from './build-identity.mjs';

function addFreshInputs(root) {
  for (const file of ['Dockerfile', '.dockerignore', 'Dockerfile.self-host', 'Dockerfile.self-host.dockerignore', 'docker-compose.self-host.yml',
    'docker/Caddyfile.self-host', 'scripts/self-host/config.mjs']) put(root, file);
  return root;
}
function freshFixture(t) {
  const root = addFreshInputs(sourceFixture(t));
  rmSync(path.join(root, 'attached_assets'), { recursive: true });
  for (const file of SOURCE_LIBRARY_POOL_APPROVAL_ASSETS) rmSync(path.join(root, file));
  return root;
}
const snapshot = root => fingerprintSource(root, POLICY);
const hash = root => snapshot(root).sourceFingerprintSha256;
const apiPart = 'artifacts/api-server/dist/build-source-part.json';
const webPart = 'artifacts/run-calculator/dist/public/build-source-part.json';

// Captured from unchanged production fixture before introducing this policy.
// This is synthetic source identity, not a production report or approval pin.
test('default production fingerprint and historical-asset requirement are unchanged', t => {
  const root = sourceFixture(t);
  assert.equal(fingerprintSource(root).sourceFingerprintSha256,
    '1b1b69d0148cb89530ebb7d5cc366ae1f2a975bebc0084c9115c245115eff878');
  addFreshInputs(root);
  assert.equal(fingerprintSource(root).sourceFingerprintSha256,
    '1b1b69d0148cb89530ebb7d5cc366ae1f2a975bebc0084c9115c245115eff878');
  rmSync(path.join(root, 'attached_assets'), { recursive: true });
  assert.throws(() => fingerprintSource(root), /missing/);
  assert.throws(() => preparePublishSource(root), /missing/);
  assert.throws(() => buildSourceRecord(root), /missing/);
  assert.equal(snapshot(root).sourcePolicy, POLICY);
});

test('fresh source does not depend on separately retained historical audit/approval assets', t => {
  const root = freshFixture(t);
  const initial = hash(root);
  for (const file of ['attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json',
    'attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.sha256',
    ...SOURCE_LIBRARY_POOL_APPROVAL_ASSETS]) {
    put(root, file, 'not operational evidence');
    assert.equal(hash(root), initial);
    assert(!snapshot(root).files.includes(file));
    assert.equal(isSourceInput(file, POLICY), false);
  }
  const record = createFreshSourceRecord(root);
  assert.equal(record.mode, 'self-host-fresh');
  assert(!JSON.stringify(record).includes(root));
  assert(!JSON.stringify(record).includes('not operational evidence'));
});

test('fresh fingerprints bind deployment/installer inputs and every normal source category', t => {
  const root = freshFixture(t);
  for (const file of ['Dockerfile', '.dockerignore', 'Dockerfile.self-host', 'Dockerfile.self-host.dockerignore', 'docker-compose.self-host.yml',
    'docker/Caddyfile.self-host', 'scripts/self-host/config.mjs', 'package.json', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', 'scripts/src/build.mjs', 'lib/math/src/index.ts',
    'artifacts/api-server/src/index.ts', 'artifacts/run-calculator/src/main.ts',
    'artifacts/api-server/build.mjs', 'artifacts/run-calculator/vite.config.ts',
    'artifacts/run-calculator/public/icon.svg']) {
    const before = hash(root);
    const bytes = readFileSync(path.join(root, file));
    for (const suffix of ['\0', 'é', ':0:', '\n']) {
      put(root, file, Buffer.concat([bytes, Buffer.from(suffix)]));
      assert.notEqual(hash(root), before, file);
      put(root, file, bytes);
      assert.equal(hash(root), before, file);
    }
  }
  // Fingerprinting tracked legacy source is not a claim that it may be shipped.
  put(root, 'artifacts/api-server/src/lib/legacyRepair.ts', 'tracked legacy code');
  assert(snapshot(root).files.includes('artifacts/api-server/src/lib/legacyRepair.ts'));
});

test('fresh fingerprint is location/order independent and ignores secrets, tests and generated records', t => {
  const roots = [freshFixture(t), freshFixture(t)];
  for (const [i, root] of roots.entries()) {
    for (const name of i === 0 ? ['a', 'b'] : ['b', 'a']) put(root, `docker/${name}`, name);
  }
  assert.equal(hash(roots[0]), hash(roots[1]));
  const root = roots[0];
  const before = hash(root);
  for (const file of ['.env', 'scripts/self-host/.env.local', 'docker/.env',
    'scripts/self-host/example.test.mjs', 'scripts/self-host/fixtures/customer.json',
    'lib/math/node_modules/private.js', 'artifacts/api-server/dist/index.mjs',
    SOURCE_RECORD_PATH, FRESH_SOURCE_RECORD_PATH, FRESH_EXPECTED_RECORD_PATH])
    put(root, file, 'synthetic-private-marker');
  assert.equal(hash(root), before);
});

for (const entry of ['Dockerfile', '.dockerignore', 'Dockerfile.self-host', 'Dockerfile.self-host.dockerignore', 'docker-compose.self-host.yml', 'docker',
  'scripts/self-host', 'lib', 'artifacts/api-server/src', 'artifacts/run-calculator/src']) {
  test(`missing fresh input refuses preparation: ${entry}`, t => {
    const root = freshFixture(t);
    rmSync(path.join(root, entry), { recursive: true });
    assert.throws(() => prepareFreshSource(root), /missing/);
    assert.equal(existsSync(path.join(root, FRESH_SOURCE_RECORD_PATH)), false);
    assert.equal(existsSync(path.join(root, FRESH_EXPECTED_RECORD_PATH)), false);
  });
}

test('unknown source policies are rejected, not treated as a production or fresh default', t => {
  const root = freshFixture(t);
  for (const policy of ['unknown', '', null, {}, 'production-source-v3']) {
    assert.throws(() => fingerprintSource(root, policy), /Unsupported/);
    assert.throws(() => isSourceInput('package.json', policy), /Unsupported/);
  }
  assert.equal(verifiedGitRevision(root, { ...snapshot(root), sourcePolicy: 'unknown' }), null);
});

test('fresh source symlinks fail closed', { skip: process.platform === 'win32'
  ? 'Windows symlink privilege unavailable; Linux covers source escape guards' : false }, t => {
  const root = freshFixture(t);
  const outside = freshFixture(t);
  symlinkSync(path.join(outside, 'package.json'), path.join(root, 'scripts/self-host/escape.mjs'));
  assert.throws(() => hash(root), /symlink/);
  rmSync(path.join(root, 'scripts/self-host/escape.mjs'));
  rmSync(path.join(root, 'docker'), { recursive: true });
  symlinkSync(path.join(outside, 'docker'), path.join(root, 'docker'));
  assert.throws(() => hash(root), /missing|symlink/);
});

test('fresh source retains bounded input budgets and required-file type checks', t => {
  const root = freshFixture(t);
  put(root, 'scripts/self-host/oversized.mjs', Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.throws(() => hash(root), /oversized/);
  rmSync(path.join(root, 'scripts/self-host/oversized.mjs'));
  rmSync(path.join(root, 'Dockerfile'));
  put(root, 'Dockerfile/invalid-child', 'not a regular Dockerfile');
  assert.throws(() => hash(root), /invalid type/);
});

test('fresh Git binding uses its own source inputs, not historical approval assets', t => {
  const root = freshFixture(t);
  const git = args => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
  }).trim();
  git(['init']);
  // Prevent line-ending conversion by a Windows host's global Git settings.
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '--force', '.']);
  git(['-c', 'user.name=Fresh Identity Fixture', '-c', 'user.email=fixture@invalid.example',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Synthetic source']);
  const revision = git(['rev-parse', 'HEAD']);
  const captured = snapshot(root);
  const binding = verifiedGitRevision(root, captured);
  let diagnostic = '';
  if (binding === null) {
    // Only this temporary synthetic fixture is inspected. Emit booleans/counts,
    // never local paths, committed contents or environment values.
    const top = path.resolve(git(['rev-parse', '--show-toplevel']));
    const entries = git(['ls-tree', '-r', '-z', '--full-tree', revision]).split('\0')
      .filter(entry => entry.includes('\t')).map(entry => {
        const [header, file] = entry.split('\t');
        const [mode, type, objectId] = header.split(' ');
        return { file, mode, type, objectId };
      }).filter(entry => entry.type === 'blob' && isSourceInput(entry.file, POLICY));
    const modesMatch = entries.every(entry => captured.gitFilesSha256.get(entry.file)?.mode === entry.mode);
    const blobsMatch = entries.every(entry => execFileSync('git', ['cat-file', 'blob', entry.objectId],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).equals(readFileSync(path.join(root, entry.file))));
    const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: root,
      input: entries.map(entry => entry.objectId).join('\n') + '\n', stdio: ['pipe', 'pipe', 'ignore'] });
    diagnostic = JSON.stringify({ rootSpellingMatch: top === path.resolve(root),
      rootCanonicalMatch: realpathSync.native(top) === realpathSync.native(root),
      sourceCountMatch: entries.length === captured.files.length, modesMatch, blobsMatch,
      batchHeaderHasCR: batch[batch.indexOf(10) - 1] === 13 });
  }
  assert.equal(binding, revision, `Synthetic Git binding diagnosis: ${diagnostic}`);
  assert.equal(verifiedGitRevision(path.join(root, 'lib'), captured), null,
    'a repository subdirectory cannot impersonate the captured source root');
  assert.equal(createFreshSourceRecord(root).gitRevision, revision);
  put(root, 'attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json', 'not evidence');
  assert.equal(createFreshSourceRecord(root).gitRevision, revision);
  put(root, 'docker/Caddyfile.self-host', 'uncommitted deployment configuration');
  assert.equal(createFreshSourceRecord(root).gitBinding, 'unavailable');
  assert.equal(verifiedGitRevision(root, captured), revision, 'captured bytes remain tied to immutable HEAD');
  git(['add', '--force', '.']);
  git(['-c', 'user.name=Fresh Identity Fixture', '-c', 'user.email=fixture@invalid.example',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'New synthetic source']);
  assert.equal(verifiedGitRevision(root, captured), null);
});

test('fresh preparation preserves production records and rejects stale reuse', t => {
  const root = addFreshInputs(sourceFixture(t));
  const production = preparePublishSource(root);
  const oldFiles = [SOURCE_RECORD_PATH, EXPECTED_RECORD_PATH].map(file => readFileSync(path.join(root, file)));
  const fresh = prepareFreshSource(root);
  assert.equal(prepareFreshSource(root, { reuse: true }).appBuildId, fresh.appBuildId);
  assert.deepEqual(readBoundedJson(path.join(root, FRESH_EXPECTED_RECORD_PATH)), fresh);
  for (const [i, file] of [SOURCE_RECORD_PATH, EXPECTED_RECORD_PATH].entries())
    assert.deepEqual(readFileSync(path.join(root, file)), oldFiles[i]);
  assert.equal(preparePublishSource(root, { reuse: true }).appBuildId, production.appBuildId);
  put(root, 'docker/Caddyfile.self-host', 'new deployment config');
  assert.throws(() => prepareFreshSource(root, { reuse: true }), /changed/);
  assert.throws(() => assertFreshSourceUnchanged(root, fresh), /changed/);
  assert.equal(preparePublishSource(root, { reuse: true }).appBuildId, production.appBuildId);
});

test('production build record selection rejects fresh and unknown modes rather than defaulting to publish', t => {
  const root = addFreshInputs(sourceFixture(t));
  preparePublishSource(root);
  for (const mode of ['self-host-fresh', 'release', '', null, {}])
    assert.throws(() => buildSourceRecord(root, mode), /Invalid production build mode/);
});

test('fresh candidate path never reuses a production record and vice versa', t => {
  const root = addFreshInputs(sourceFixture(t));
  const production = preparePublishSource(root);
  const fresh = prepareFreshSource(root);
  put(root, FRESH_SOURCE_RECORD_PATH, JSON.stringify(production));
  assert.throws(() => prepareFreshSource(root, { reuse: true }), /Invalid fresh/);
  put(root, SOURCE_RECORD_PATH, JSON.stringify(fresh));
  assert.throws(() => preparePublishSource(root, { reuse: true }), /Invalid prepared/);
});

test('fresh stages require their independent prepared candidate, both outputs and matching records', t => {
  const root = freshFixture(t);
  const record = createFreshSourceRecord(root);
  outputs(root);
  assert.throws(() => completeFreshBuildStage(root, record, 'api'), /ENOENT/);
  const prepared = prepareFreshSource(root);
  assert.throws(() => completeFreshBuildStage(root, record, 'api'), /does not match/);
  assert.throws(() => completeFreshBuildStage(root, prepared, 'other'), /Invalid fresh build stage/);
  rmSync(path.join(root, 'artifacts/api-server/dist/index.mjs'));
  assert.throws(() => completeFreshBuildStage(root, prepared, 'api'), /entry is missing/);
  outputs(root);
  assert.equal(completeFreshBuildStage(root, prepared, 'api'), false);
  assert.throws(() => sealFreshBuildIdentity(root), /Both fresh/);
  const sealed = completeFreshBuildStage(root, prepared, 'web');
  assert.equal(sealed.buildMode, 'self-host-fresh');
  assert.equal(sealed.sourcePolicy, POLICY);
  assert.equal(sealed.appBuildId, prepared.appBuildId);
  const apiInfo = readBoundedJson(path.join(root, 'artifacts/api-server/dist/build-info.json'));
  const webInfo = readBoundedJson(path.join(root, 'artifacts/run-calculator/dist/public/build-info.json'));
  assert.deepEqual(apiInfo, webInfo);
  assert.deepEqual(validateFreshBuildInfo(apiInfo), sealed);
  put(root, 'docker/Caddyfile.self-host', 'later source mutation');
  assert.throws(() => sealFreshBuildIdentity(root), /changed/);
});

for (const stage of ['api', 'web']) {
  test(`fresh sealing detects ${stage} compiled-output tampering`, t => {
    const root = freshFixture(t);
    const record = prepareFreshSource(root);
    outputs(root);
    completeFreshBuildStage(root, record, 'api');
    completeFreshBuildStage(root, record, 'web');
    put(root, stage === 'api' ? 'artifacts/api-server/dist/index.mjs'
      : 'artifacts/run-calculator/dist/public/index.html', 'changed output');
    assert.throws(() => sealFreshBuildIdentity(root), /compiled output changed/);
  });
}

test('mixed production/fresh stages cannot seal in either profile', t => {
  const root = addFreshInputs(sourceFixture(t));
  const production = preparePublishSource(root);
  const fresh = prepareFreshSource(root);
  outputs(root);
  completeBuildStage(root, production, 'api');
  assert.equal(completeFreshBuildStage(root, fresh, 'web'), false);
  assert.throws(() => sealFreshBuildIdentity(root), /do not share/);
  assert.throws(() => sealBuildIdentity(root), /do not share/);
  completeFreshBuildStage(root, fresh, 'api');
  assert.throws(() => sealBuildIdentity(root), /do not share/);
  assert.equal(sealFreshBuildIdentity(root).buildMode, 'self-host-fresh');
  const newFresh = prepareFreshSource(root);
  assert.throws(() => sealFreshBuildIdentity(root), /do not share/);
  assert.equal(completeFreshBuildStage(root, newFresh, 'api'), false);
  assert.equal(completeFreshBuildStage(root, newFresh, 'web').appBuildId, newFresh.appBuildId);
});

for (const [name, mutate] of [
  ['extra field', part => ({ ...part, secret: 'synthetic' })],
  ['wrong stage', part => ({ ...part, stage: 'api' })],
  ['invalid timestamp', part => ({ ...part, completedAt: 'tomorrow' })],
  ['invalid output digest', part => ({ ...part, outputFingerprintSha256: 'x' })],
]) {
  test(`malformed fresh stage rejected: ${name}`, t => {
    const root = freshFixture(t);
    const record = prepareFreshSource(root);
    outputs(root);
    completeFreshBuildStage(root, record, 'api');
    completeFreshBuildStage(root, record, 'web');
    const part = readBoundedJson(path.join(root, webPart));
    put(root, webPart, JSON.stringify(mutate(part)));
    assert.throws(() => sealFreshBuildIdentity(root), /Invalid completed/);
  });
}

test('fresh validators reject forged production/development scope and unrelated platform labels', t => {
  const record = createFreshSourceRecord(freshFixture(t));
  const info = freshBuildInfoFromRecord(record);
  for (const sourcePolicy of ['production-source-v4', 'self-host-fresh-source-v2', 'unknown']) {
    assert.throws(() => validateFreshSourceRecord({ ...record, sourcePolicy }));
    assert.throws(() => validateFreshBuildInfo({ ...info, sourcePolicy }));
  }
  for (const mode of ['publish', 'development', 'release']) {
    assert.throws(() => validateFreshSourceRecord({ ...record, mode }));
    assert.throws(() => validateFreshBuildInfo({ ...info, buildMode: mode }));
  }
  for (const mutation of [
    { schemaVersion: 2 }, { appBuildId: 'invented' }, { sourceFingerprintSha256: 'not a hash' },
    { gitRevision: 'a'.repeat(40), gitBinding: 'unavailable' }, { gitBinding: 'verified' },
    { gitRevision: 'a'.repeat(64), gitBinding: 'verified' }, { secret: 'synthetic' },
  ]) {
    assert.throws(() => validateFreshSourceRecord({ ...record, ...mutation }));
    assert.throws(() => validateFreshBuildInfo({ ...info, ...mutation }));
  }
  assert.throws(() => validateFreshSourceRecord({ ...record, preparedAt: 'tomorrow' }));
  assert.throws(() => validateFreshBuildInfo({ ...info, completedAt: 'tomorrow' }));
  assert.throws(() => validateFreshBuildInfo({ ...info, platformDeploymentId: 'replit-id' }));
  assert.throws(() => validateFreshBuildInfo({ ...info, platformIdentitySource: 'runtime-reported' }));
  assert.equal(freshSourceRecordDigest(record), freshSourceRecordDigest({ ...record }));
});

test('fresh records fail production validators and release assessment before any live request', async t => {
  const record = prepareFreshSource(freshFixture(t));
  const info = freshBuildInfoFromRecord(record);
  assert.throws(() => validateSourceRecord(record), /Invalid prepared/);
  assert.throws(() => validateBuildInfo(info), /Invalid sealed/);
  assert.throws(() => validateSourceRecord({ ...record, mode: 'publish' }), /Invalid prepared/);
  assert.throws(() => validateBuildInfo({ ...info, buildMode: 'release' }), /Invalid sealed/);
  assert.throws(() => assessmentRevision(POLICY, record.sourceFingerprintSha256, 'a'.repeat(64)), /Invalid source/);
  let requests = 0;
  const options = { url: 'https://not-used.invalid', expected: record,
    fetchImpl: async () => { requests++; throw new Error('network must not run'); } };
  await assert.rejects(verifyPublishedBuild(options), /Invalid prepared/);
  await assert.rejects(createPublishedSourceHandoff(options), /Invalid prepared/);
  assert.equal(requests, 0);
});

test('production expectation cannot accept a fresh runtime identity as a release', async t => {
  const root = addFreshInputs(sourceFixture(t));
  const expected = preparePublishSource(root);
  const freshInfo = freshBuildInfoFromRecord(prepareFreshSource(root));
  for (const actual of [freshInfo, { ...freshInfo, buildMode: 'release' }]) {
    let requests = 0;
    await assert.rejects(verifyPublishedBuild({ url: 'https://not-used.invalid', expected,
      fetchImpl: async () => { requests++; return new Response(JSON.stringify(actual), {
        headers: { 'Content-Type': 'application/json' }, status: 200,
      }); } }), /Invalid sealed/);
    assert.equal(requests, 1, 'no readiness request or receipt follows a rejected fresh identity');
  }
});

test('fresh identity helpers do not expose an alternate installer, network or runtime switch', t => {
  const root = freshFixture(t);
  assert.equal(existsSync(path.join(root, FRESH_SOURCE_RECORD_PATH)), false);
  assert.throws(() => outputFingerprint(root, 'not-a-stage'), /Invalid build stage/);
  // All records here are synthetic. A seal is not repair/package/runtime approval.
  const record = prepareFreshSource(root);
  assert.equal(record.sourcePolicy, POLICY);
  assert.equal(existsSync(path.join(root, SOURCE_RECORD_PATH)), false);
  assert.equal(existsSync(path.join(root, EXPECTED_RECORD_PATH)), false);
  assert.equal(existsSync(path.join(root, apiPart)), false);
});
