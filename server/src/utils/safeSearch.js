export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildLiteralSearchRegex(value, { maxLength = 100 } = {}) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return new RegExp(escapeRegExp(normalized.slice(0, maxLength)), 'i');
}
