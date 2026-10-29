import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvironment, initialize, validateSetup } from './config.mjs';
import { planUpdate, validateRelease, localClock } from './update-policy.mjs';
const setup = { site: 'runcalc.factory.lan', timeZone: 'America/Chicago', manager: 'manager1' };
const digest = 'b'.repeat(64);
const current = 'a'.repeat(40), next = 'c'.repeat(40);
function input(now = '2026-10-29T05:45:00Z') {
  return { now, timeZone: setup.timeZone,
    release: { version: 1, repository: 'ravenslight2010/Production-run-calculator', channel: 'main',
      sourceCommit: next, schema: 'baseline-1', images: Object.fromEntries(['api','web'].map(role =>
        [role, `ghcr.io/ravenslight2010/production-run-calculator-${role}@sha256:${digest}`])) },
    installed: { sourceCommit: current, schema: 'baseline-1', installationId: 'local-test-only' },
    evidence: { signatureVerified: true, clockSynchronized: true, maintenanceLockHeld: true,
      inFlightRequests: 0, pendingClientWrites: 0, coreHealthy: true, imagesCached: true, rollbackImagesCached: true,
      reset: { completedAt: '2026-10-29T05:05:00Z', success: true, installationId: 'local-test-only', sourceCommit: current },
      backup: { completedAt: '2026-10-29T05:35:00Z', success: true, installationId: 'local-test-only', sourceCommit: current,
        sha256: digest, restoreVerified: true } } };
}
test('generated secrets are independent and environment is local-only', () => {
  const content = createEnvironment(setup);
  const pairs = Object.fromEntries(content.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0,i), line.slice(i+1)];
  }));
  assert.equal(pairs.DATABASE_URL, `postgresql://runcalc_user:${pairs.POSTGRES_PASSWORD}@db:5432/runcalc`);
  const secrets = [pairs.POSTGRES_PASSWORD, pairs.STAFF_SIGNUP_CODE, pairs.INITIAL_MANAGER_ACCESS_CODE];
  assert.ok(secrets.every(value => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(new Set(secrets).size, 3);
  assert.equal(pairs.LOCAL_AI_FALLBACK_TO_GEMINI, 'false');
  assert.equal(pairs.LOCAL_AI_STRICT_READINESS, 'false');
  assert.equal(pairs.TZ, setup.timeZone);
  assert.ok(!/GOOGLE_API_KEY|OPENAI_API_KEY|AI_INTEGRATIONS_/.test(content));
});
for (const site of ['http://host.lan', 'host.lan:443', 'a.lan\nX=oops', '*.lan', 'localhost', 'a..lan', '-x.lan', 'a.lan/path']) {
  test(`reject hostname injection: ${JSON.stringify(site)}`, () => assert.throws(() => validateSetup({ ...setup, site })));
}
test('requires explicit valid timezone and manager', () => {
  for (const timeZone of ['', undefined, 'Mars/Factory', 'America/Chicago\nPORT=80'])
    assert.throws(() => validateSetup({ ...setup, timeZone }));
  assert.throws(() => validateSetup({ ...setup, manager: 'manager\nEVIL=yes' }));
});
test('initializer refuses to replace existing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'selfhost-test-'));
  try {
    await initialize(directory, setup);
    const first = await readFile(join(directory, 'self-host.env'), 'utf8');
    await assert.rejects(initialize(directory, setup), { code: 'EEXIST' });
    assert.equal(await readFile(join(directory, 'self-host.env'), 'utf8'), first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('eligible is only a planning candidate, not an automatic apply', () => {
  const p = planUpdate(input()); assert.equal(p.eligible, true); assert.deepEqual(p.reasons, []);
  assert.equal(p.action, 'candidate-for-rehearsed-updater');
});
test('empty evidence fails closed without affecting current app', () => {
  const x = input(); x.evidence = {};
  const p = planUpdate(x); assert.equal(p.eligible, false);
  assert.equal(p.action, 'skip-without-changing-running-app'); assert.ok(p.reasons.length >= 9);
});
for (const field of ['signatureVerified','clockSynchronized','maintenanceLockHeld','coreHealthy','imagesCached','rollbackImagesCached']) {
  test(`requires real evidence: ${field}`, () => { const x = input(); x.evidence[field] = false; assert.equal(planUpdate(x).eligible, false); });
}
for (const field of ['inFlightRequests', 'pendingClientWrites']) {
  test(`blocks unflushed clients: ${field}`, () => { const x = input(); x.evidence[field] = 1; assert.ok(planUpdate(x).reasons.includes('clients-not-quiescent')); });
}
for (const kind of ['reset','backup']) {
  for (const patch of [{ success: false }, { completedAt: 'invalid' }, { completedAt: '2026-10-28T23:55:00Z' },
    { completedAt: '2026-10-29T06:00:00Z' }, { installationId: 'another-host' }, { sourceCommit: next }]) {
    test(`${kind} receipt must be current and installation-bound: ${JSON.stringify(patch)}`, () => {
      const x = input(); Object.assign(x.evidence[kind], patch); assert.equal(planUpdate(x).eligible, false);
    });
  }
}
test('backup must have hash and restore verification', () => {
  for (const patch of [{ sha256: '' }, { restoreVerified: false }]) {
    const x = input(); Object.assign(x.evidence.backup, patch); assert.ok(planUpdate(x).reasons.includes('backup-not-restore-verified'));
  }
});
test('schema changes and already-current releases do not apply', () => {
  const x = input(); x.release.schema = 'different'; assert.ok(planUpdate(x).reasons.includes('schema-change-needs-reviewed-migration'));
  x.release.sourceCommit = current; assert.ok(planUpdate(x).reasons.includes('already-current'));
});
for (const [instant, blocked] of [
  ['2026-10-29T05:00:00Z', true], ['2026-10-29T05:29:59Z', true],
  ['2026-10-29T05:30:00Z', false], ['2026-10-29T09:30:00Z', true],
  ['2026-10-29T10:00:00Z', true], ['2026-10-29T02:00:00Z', true],
]) test(`local update window boundary ${instant}`, () => {
  assert.equal(planUpdate(input(instant)).reasons.includes('outside-post-reset-window'), blocked);
});
test('DST fallback repeats local hour safely; no host timezone assumptions', () => {
  assert.deepEqual(localClock('2026-11-01T06:45:00Z', 'America/Chicago'), localClock('2026-11-01T07:45:00Z', 'America/Chicago'));
  assert.equal(localClock('2026-03-08T08:00:00Z', 'America/Chicago').minute, 180);
  assert.throws(() => localClock('bad', setup.timeZone));
  assert.throws(() => localClock('2026-10-29T05:30:00Z', undefined));
});
test('release rejects mutable tags, other registries, roles, repositories and branch', () => {
  for (const image of ['ghcr.io/ravenslight2010/production-run-calculator-api:latest',
    `ghcrXio/ravenslight2010/production-run-calculator-api@sha256:${digest}`,
    `ghcr.io/attacker/production-run-calculator-api@sha256:${digest}`]) {
    const x = input(); x.release.images.api = image; assert.throws(() => validateRelease(x.release));
  }
  for (const patch of [{ channel: 'Replit' }, { sourceCommit: 'abc123' }, { schema: '' }, { version: 2 }, { repository: 'other/repo' }]) {
    const x = input(); Object.assign(x.release, patch); assert.throws(() => validateRelease(x.release));
  }
});
test('receipts from another facility day never authorize a restart', () => {
  const x = input('2026-10-30T05:45:00Z'); assert.equal(planUpdate(x).eligible, false);
});
test('compose startup does not require a schema push, model download or exposed DB/AI ports', async () => {
  const text = await readFile(new URL('../../docker-compose.self-host.yml', import.meta.url), 'utf8');
  const api = text.slice(text.indexOf('  api:'), text.indexOf('  web:'));
  assert.ok(!api.includes('migrate:') && !api.includes('ollama:'));
  assert.ok(text.includes('profiles: [initialize]') && text.includes('profiles: [prepare-ai]'));
  assert.ok(!text.includes('5432:5432') && !text.includes('11434:11434'));
  const caddy = await readFile(new URL('../../docker/Caddyfile.self-host', import.meta.url), 'utf8');
  assert.ok(caddy.includes('tls internal')); assert.ok(!caddy.includes('googleapis.com'));
});
