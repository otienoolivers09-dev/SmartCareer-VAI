export function requireSignedInUser({ user, onMissing, message = 'Please sign in to continue.' } = {}) {
  if (user) {
    return { ok: true, user, message: '' };
  }

  if (typeof onMissing === 'function') {
    onMissing();
  }

  return { ok: false, user: null, message };
}
