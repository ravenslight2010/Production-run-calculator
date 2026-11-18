'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const picomatch = require('..');

test('normalizes repeated edge-star extglobs without changing their matches', () => {
  assert.equal(picomatch.isMatch('abc', '+(*)c'), true);
  assert.equal(picomatch.isMatch('aaaz', '+(*a)z'), true);
  assert.equal(picomatch.isMatch('aabz', '+(*a)z'), false);
  assert.equal(picomatch.isMatch('abcx', '+(*a)z'), false);
  assert.equal(picomatch.isMatch('abbb', '+(a*)'), true);
});

test('does not backtrack on repeated extglobs containing raw stars', () => {
  const modulePath = path.resolve(__dirname, '..');
  const probe = [
    `const picomatch = require(${JSON.stringify(modulePath)});`,
    `picomatch.isMatch('a'.repeat(6000) + 'x', process.argv[1]);`
  ].join('\n');

  for (const pattern of ['+(*)z', '+(*a)z', '+(a*b)z']) {
    const result = spawnSync(process.execPath, ['-e', probe, pattern], {
      encoding: 'utf8',
      timeout: 1500
    });

    assert.equal(result.error, undefined, `${pattern} must finish within the bounded probe`);
    assert.equal(result.status, 0, `${pattern} should exit normally: ${result.stderr}`);
  }
});

test('keeps ordinary repeated extglobs unchanged', () => {
  assert.equal(picomatch.isMatch('abcabc', '+(abc)'), true);
  assert.equal(picomatch.isMatch('foobar', '*(foo|bar)'), true);
});
