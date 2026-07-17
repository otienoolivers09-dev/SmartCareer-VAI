export function truncateToFirstWords(text, limit = 100) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  const words = text.trim().split(/\s+/);
  if (words.length <= limit) {
    return text.trim();
  }

  return `${words.slice(0, limit).join(' ')}...`;
}
