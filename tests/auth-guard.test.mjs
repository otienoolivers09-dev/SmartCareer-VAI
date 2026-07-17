import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSignedInUser } from '../public/auth-guard.js';

test('returns true when a signed-in user exists', () => {
  const result = requireSignedInUser({ user: { uid: 'abc' } });
  assert.equal(result.ok, true);
  assert.equal(result.user.uid, 'abc');
});

test('returns false and calls the fallback when no user is present', () => {
  let called = false;
  const result = requireSignedInUser({
    user: null,
    onMissing: () => {
      called = true;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(called, true);
  assert.match(result.message, /sign in/i);
});
