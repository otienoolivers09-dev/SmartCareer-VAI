import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessFullContent } from '../server/access-control.js';

test('denies full-content access without a verified payment or valid token', () => {
  assert.equal(canAccessFullContent({ paymentRecord: null, tokenRecord: null }), false);
  assert.equal(canAccessFullContent({ paymentRecord: { status: 'PENDING' }, tokenRecord: null }), false);
});

test('allows access when a completed payment exists', () => {
  assert.equal(canAccessFullContent({ paymentRecord: { status: 'COMPLETED' }, tokenRecord: null }), true);
  assert.equal(canAccessFullContent({ paymentRecord: { status: 'PAID' }, tokenRecord: null }), true);
});

test('allows access for an unused, unexpired token', () => {
  const tokenRecord = {
    used: false,
    expires_at: new Date(Date.now() + 60_000).toISOString()
  };

  assert.equal(canAccessFullContent({ paymentRecord: null, tokenRecord }), true);
});

test('denies access for an expired or already used token', () => {
  const usedToken = { used: true, expires_at: new Date(Date.now() + 60_000).toISOString() };
  const expiredToken = { used: false, expires_at: new Date(Date.now() - 60_000).toISOString() };

  assert.equal(canAccessFullContent({ paymentRecord: null, tokenRecord: usedToken }), false);
  assert.equal(canAccessFullContent({ paymentRecord: null, tokenRecord: expiredToken }), false);
});
