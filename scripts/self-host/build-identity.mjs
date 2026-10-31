// Fresh-profile identity primitives. Only explicit fresh build entrypoints select them.
// Production validators deliberately do not accept these records.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  fingerprintSource, SELF_HOST_FRESH_SOURCE_POLICY, verifiedGitRevision,
} from '../src/build-source-files.mjs';
import {
  INFO_KEYS, outputFingerprint, readBoundedJson, writeRecord,
} from '../src/build-source-identity.mjs';

export const FRESH_SOURCE_RECORD_PATH = 'artifacts/api-server/self-host-source-record.json';
export const FRESH_EXPECTED_RECORD_PATH = '.local/build-identity/self-host-expected-source.json';
const MODE = 'self-host-fresh';
const SOURCE_KEYS = ['schemaVersion', 'kind', 'appBuildId', 'sourcePolicy',
  'sourceFingerprintSha256', 'gitRevision', 'gitBinding', 'preparedAt', 'mode'];
const SHA = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const APP_ID = /^app-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exactKeys = (r, keys) => r && typeof r === 'object' && !Array.isArray(r) &&
  Object.keys(r).length === keys.length && keys.every(key => Object.hasOwn(r, key));
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const validSource = r => r.schemaVersion === 1 && APP_ID.test(r.appBuildId) &&
  r.sourcePolicy === SELF_HOST_FRESH_SOURCE_POLICY && SHA.test(r.sourceFingerprintSha256) &&
  (r.gitRevision === null ? r.gitBinding === 'unavailable' :
    typeof r.gitRevision === 'string' && GIT.test(r.gitRevision) && r.gitBinding === 'verified');

export function validateFreshSourceRecord(record) {
  if (!exactKeys(record, SOURCE_KEYS) || !validSource(record) ||
      record.kind !== 'prepared-build-source' || record.mode !== MODE || !validDate(record.preparedAt))
    throw new Error('Invalid fresh self-host source record.');
  return record;
}

export function validateFreshBuildInfo(record) {
  // Platform labels are unavailable: Replit runtime labels cannot confer authority
  // on this separate profile. A future host identity needs its own reviewed contract.
  if (!exactKeys(record, INFO_KEYS) || !validSource(record) ||
      record.kind !== 'app-build-info' || record.buildMode !== MODE || !validDate(record.completedAt) ||
      record.platformDeploymentId !== null || record.platformBuildId !== null ||
      record.platformIdentitySource !== 'unavailable')
    throw new Error('Invalid fresh self-host build identity.');
  return record;
}

export function createFreshSourceRecord(root) {
  const snapshot = fingerprintSource(root, SELF_HOST_FRESH_SOURCE_POLICY);
  const gitRevision = verifiedGitRevision(root, snapshot);
  if (fingerprintSource(root, SELF_HOST_FRESH_SOURCE_POLICY).sourceFingerprintSha256 !== snapshot.sourceFingerprintSha256)
    throw new Error('Fresh build source changed while preparing its identity.');
  return validateFreshSourceRecord({
    schemaVersion: 1, kind: 'prepared-build-source', appBuildId: `app-build:${randomUUID()}`,
    sourcePolicy: snapshot.sourcePolicy, sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
    gitRevision, gitBinding: gitRevision === null ? 'unavailable' : 'verified',
    preparedAt: new Date().toISOString(), mode: MODE,
  });
}

export function assertFreshSourceUnchanged(root, record) {
  validateFreshSourceRecord(record);
  if (fingerprintSource(root, SELF_HOST_FRESH_SOURCE_POLICY).sourceFingerprintSha256 !== record.sourceFingerprintSha256)
    throw new Error('Fresh build source changed. Prepare a new fresh source identity.');
}

export function prepareFreshSource(root, { reuse = false } = {}) {
  const candidate = path.join(root, FRESH_SOURCE_RECORD_PATH);
  const record = reuse && existsSync(candidate)
    ? validateFreshSourceRecord(readBoundedJson(candidate)) : createFreshSourceRecord(root);
  assertFreshSourceUnchanged(root, record);
  writeRecord(candidate, record);
  writeRecord(path.join(root, FRESH_EXPECTED_RECORD_PATH), record);
  return record;
}

export function buildFreshSourceRecord(root) {
  const record = validateFreshSourceRecord(readBoundedJson(path.join(root, FRESH_SOURCE_RECORD_PATH)));
  assertFreshSourceUnchanged(root, record);
  return record;
}

export function freshSourceRecordDigest(record) {
  validateFreshSourceRecord(record);
  return createHash('sha256').update('self-host-fresh-record-v1\0')
    .update(JSON.stringify(SOURCE_KEYS.map(key => [key, record[key]]))).digest('hex');
}

export function freshBuildInfoFromRecord(record, completedAt = new Date().toISOString()) {
  validateFreshSourceRecord(record);
  return validateFreshBuildInfo({
    schemaVersion: 1, kind: 'app-build-info', appBuildId: record.appBuildId,
    sourcePolicy: record.sourcePolicy, sourceFingerprintSha256: record.sourceFingerprintSha256,
    gitRevision: record.gitRevision, gitBinding: record.gitBinding, completedAt, buildMode: MODE,
    platformDeploymentId: null, platformBuildId: null, platformIdentitySource: 'unavailable',
  });
}

const partFile = (root, stage) => path.join(root, stage === 'api'
  ? 'artifacts/api-server/dist/build-source-part.json'
  : 'artifacts/run-calculator/dist/public/build-source-part.json');

export function completeFreshBuildStage(root, record, stage) {
  if (!['api', 'web'].includes(stage)) throw new Error('Invalid fresh build stage.');
  assertFreshSourceUnchanged(root, record);
  // Require the separately prepared candidate, not an ad-hoc record supplied by
  // a build stage. No stage may overwrite production preparation/expectations.
  const prepared = validateFreshSourceRecord(readBoundedJson(path.join(root, FRESH_SOURCE_RECORD_PATH)));
  if (freshSourceRecordDigest(record) !== freshSourceRecordDigest(prepared))
    throw new Error('Fresh stage does not match its prepared source identity.');
  writeRecord(partFile(root, stage), {
    schemaVersion: 1, kind: 'build-source-part', stage, record,
    completedAt: new Date().toISOString(), outputFingerprintSha256: outputFingerprint(root, stage),
  });
  return sealFreshBuildIdentity(root, false);
}

export function sealFreshBuildIdentity(root, required = true) {
  const record = validateFreshSourceRecord(readBoundedJson(path.join(root, FRESH_SOURCE_RECORD_PATH)));
  assertFreshSourceUnchanged(root, record);
  const parts = [];
  for (const stage of ['api', 'web']) {
    const file = partFile(root, stage);
    if (!existsSync(file)) {
      if (required) throw new Error('Both fresh API and web stages must complete before sealing.');
      return false;
    }
    const part = readBoundedJson(file);
    if (!exactKeys(part, ['schemaVersion', 'kind', 'stage', 'record', 'completedAt', 'outputFingerprintSha256']) ||
        part.schemaVersion !== 1 || part.kind !== 'build-source-part' || part.stage !== stage ||
        !validDate(part.completedAt) || !SHA.test(part.outputFingerprintSha256))
      throw new Error('Invalid completed fresh build stage.');
    let digest;
    try { digest = freshSourceRecordDigest(part.record); }
    catch {
      if (required) throw new Error('Fresh stages do not share the prepared source identity.');
      return false;
    }
    if (digest !== freshSourceRecordDigest(record)) {
      if (required) throw new Error('Fresh stages do not share the prepared source identity.');
      return false;
    }
    if (outputFingerprint(root, stage) !== part.outputFingerprintSha256)
      throw new Error('Fresh compiled output changed after its build stage completed.');
    parts.push(part);
  }
  const info = freshBuildInfoFromRecord(record, parts.map(part => part.completedAt).sort().at(-1));
  writeRecord(path.join(root, 'artifacts/api-server/dist/build-info.json'), info);
  writeRecord(path.join(root, 'artifacts/run-calculator/dist/public/build-info.json'), info);
  return info;
}
