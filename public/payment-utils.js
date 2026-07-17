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

export function getCoverLetterPreviewText(text, isUnlocked = false) {
  if (typeof text !== 'string') {
    return '';
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  if (isUnlocked) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/);
  const previewWordCount = words.length <= 40
    ? Math.max(1, Math.floor(words.length / 2))
    : Math.max(40, Math.floor(words.length / 2));
  const preview = words.slice(0, previewWordCount).join(' ').trim();

  return `${preview}…\n\nUnlock to view the full cover letter and download it.`;
}
