import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateToFirstWords } from '../public/payment-utils.js';

test('truncates content to the first 100 words', () => {
  const input = Array.from({ length: 105 }, (_, index) => `word${index + 1}`).join(' ');
  const result = truncateToFirstWords(input, 100);
  const words = result.split(/\s+/).filter(Boolean);

  assert.equal(words.length, 100);
  assert.match(result, /\.\.\.$/);
  assert.equal(words[0], 'word1');
  assert.match(words[99], /^word100/);
});

test('returns the original text when it is already short', () => {
  const input = 'One two three';
  assert.equal(truncateToFirstWords(input, 100), input);
});
