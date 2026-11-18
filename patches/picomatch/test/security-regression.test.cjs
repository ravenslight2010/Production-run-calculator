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

  for (const pattern of ['+(*)z', '+(*a)z', '+(a*b)z', '*(*)z', '*(*a)z', '+(*|?)z']) {
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

test('GHSA-c2c7-rcm5-vvqj: overlapping and nested quantifiers finish within a deadline', () => {
  const modulePath = path.resolve(__dirname, '..');
  const probe = [
    `const picomatch = require(${JSON.stringify(modulePath)});`,
    `const assert = require('node:assert/strict');`,
    `assert.equal(picomatch.isMatch('a'.repeat(80) + '!', process.argv[1]), false);`
  ].join('\n');

  for (const pattern of ['+(a|aa)', '+(+(a))', '*(+(a))', '+(+(+(a)))']) {
    const result = spawnSync(process.execPath, ['-e', probe, pattern], {
      encoding: 'utf8',
      timeout: 1500
    });
    assert.equal(result.error, undefined, `${pattern} must finish within the bounded probe`);
    assert.equal(result.status, 0, `${pattern} should reject the input: ${result.stderr}`);
  }
});

test('GHSA-3v7f-55p6-f55p: POSIX classes cannot resolve inherited methods', () => {
  const { POSIX_REGEX_SOURCE } = require('../lib/constants');
  assert.equal(Object.getPrototypeOf(POSIX_REGEX_SOURCE), null);
  for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
    assert.equal(POSIX_REGEX_SOURCE[name], undefined);
    const expression = picomatch.makeRe(`[[:${name}:]]`);
    assert.doesNotMatch(expression.source, /function|native code/);
    assert.equal(picomatch.isMatch('c', `[[:${name}:]]`), false);
  }
  assert.equal(picomatch.isMatch('7', '[[:digit:]]'), true);
  assert.equal(picomatch.isMatch('a', '[[:digit:]]'), false);
  assert.equal(picomatch.isMatch('z', '[[:alpha:]]'), true);
});
