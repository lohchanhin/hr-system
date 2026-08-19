function toId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value._id || value.id ? String(value._id || value.id) : '';
}

function isSameShift(first, second) {
  if (first === second) return true;
  const firstId = toId(first);
  const secondId = toId(second);
  return Boolean(firstId && secondId && firstId === secondId);
}

export function normalizeShiftIdentifier(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .toUpperCase();
}

function identityEntries(shift) {
  return [
    { field: 'code', label: '班別代碼', value: String(shift?.code || '').trim() },
    { field: 'name', label: '班別名稱', value: String(shift?.name || '').trim() },
  ].filter((entry) => normalizeShiftIdentifier(entry.value));
}

export class ShiftIdentityConflictError extends Error {
  constructor(conflict) {
    const existingName = String(conflict.existingShift?.name || conflict.existingShift?.code || '').trim();
    super(`${conflict.candidateLabel}「${conflict.value}」已由班別「${existingName}」作為${conflict.existingLabel}使用`);
    this.name = 'ShiftIdentityConflictError';
    this.statusCode = 409;
    this.code = 'SHIFT_IDENTIFIER_CONFLICT';
    this.conflict = conflict;
  }
}

export function findShiftIdentityConflict(shifts, candidate, { excludeId = '' } = {}) {
  const ignoredId = toId(excludeId);
  const candidateEntries = identityEntries(candidate);

  for (const existingShift of shifts || []) {
    if (ignoredId && toId(existingShift) === ignoredId) continue;
    for (const candidateEntry of candidateEntries) {
      const normalizedCandidate = normalizeShiftIdentifier(candidateEntry.value);
      for (const existingEntry of identityEntries(existingShift)) {
        if (normalizedCandidate !== normalizeShiftIdentifier(existingEntry.value)) continue;
        return {
          value: candidateEntry.value,
          candidateField: candidateEntry.field,
          candidateLabel: candidateEntry.label,
          existingField: existingEntry.field,
          existingLabel: existingEntry.label,
          existingShift,
        };
      }
    }
  }
  return null;
}

export function assertUniqueShiftIdentity(shifts, candidate, options) {
  const conflict = findShiftIdentityConflict(shifts, candidate, options);
  if (conflict) throw new ShiftIdentityConflictError(conflict);
}

export function buildShiftIdentityLookup(shifts) {
  const lookup = new Map();
  const conflicts = [];

  for (const shift of shifts || []) {
    for (const entry of identityEntries(shift)) {
      const key = normalizeShiftIdentifier(entry.value);
      const existing = lookup.get(key);
      if (existing && !isSameShift(existing.shift, shift)) {
        conflicts.push({
          identifier: entry.value,
          firstShift: existing.shift,
          firstField: existing.field,
          secondShift: shift,
          secondField: entry.field,
        });
        continue;
      }
      lookup.set(key, { shift, field: entry.field });
    }
  }

  return {
    lookup: new Map([...lookup].map(([key, value]) => [key, value.shift])),
    conflicts,
  };
}
