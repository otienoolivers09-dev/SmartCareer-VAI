export function canAccessFullContent({ paymentRecord, tokenRecord }) {
  if (tokenRecord) {
    if (tokenRecord.used) return false;
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) return false;
    return true;
  }

  if (!paymentRecord) return false;
  return paymentRecord.status === 'COMPLETED' || paymentRecord.status === 'PAID';
}
