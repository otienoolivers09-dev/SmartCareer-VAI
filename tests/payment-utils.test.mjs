import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoverLetterPreviewText } from '../public/payment-utils.js';

test('returns the full cover letter when unlocked', () => {
  const text = 'This is a cover letter with enough words to make a preview necessary for the paywall experience.';

  assert.equal(getCoverLetterPreviewText(text, true), text);
});

test('returns a truncated preview when locked', () => {
  const text = 'This is a cover letter with enough words to make a preview necessary for the paywall experience and the user should see only part of it before paying.';
  const preview = getCoverLetterPreviewText(text, false);

  assert.match(preview, /Unlock/i);
  assert.ok(preview.length < text.length);
  assert.ok(preview.includes('This is a cover letter'));
});
