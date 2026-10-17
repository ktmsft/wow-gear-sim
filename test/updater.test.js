import test from 'node:test';
import assert from 'node:assert/strict';

import { compareVersions, parseTagVersion } from '../updater.js';

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
  assert.ok(compareVersions('1.2.0', '1.1.0') > 0);
  assert.ok(compareVersions('1.1.0', '1.2.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.ok(compareVersions('1.1.10', '1.1.2') > 0);
});

test('parseTagVersion reads the app semver from release tags', () => {
  assert.equal(parseTagVersion('v1.1.0-r1'), '1.1.0');
  assert.equal(parseTagVersion('v12.3.45-r678'), '12.3.45');
  assert.equal(parseTagVersion('v2.0.0'), '2.0.0');
  assert.equal(parseTagVersion('simc-1105'), null);
  assert.equal(parseTagVersion('1.1.0'), null);
  assert.equal(parseTagVersion(undefined), null);
});
