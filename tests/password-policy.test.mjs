import assert from 'node:assert/strict';
import test from 'node:test';
import { isStrongPassword } from '../lib/password-policy.mjs';

test('accepts passwords with required length and character classes', () => {
  assert.equal(isStrongPassword('GautengAsset2026!'), true);
});

test('rejects passwords missing uppercase, lowercase, number, or symbol', () => {
  assert.equal(isStrongPassword('gautengasset2026!'), false);
  assert.equal(isStrongPassword('GAUTENGASSET2026!'), false);
  assert.equal(isStrongPassword('GautengAssetStrong!'), false);
  assert.equal(isStrongPassword('GautengAsset2026'), false);
});

test('rejects passwords outside the 12 to 128 character range', () => {
  assert.equal(isStrongPassword('Aa1!short'), false);
  assert.equal(isStrongPassword(`Aa1!${'x'.repeat(125)}`), false);
});
