import AttendanceSetting from '../models/AttendanceSetting.js';

export const SHIFT_SEMANTIC_TYPES = new Set([
  'work',
  'rest_day',
  'regular_rest',
  'holiday',
  'leave',
]);

const LEAVE_CODES = new Set(['特', '病', '事', '喪', '公', '原', '補']);
const LEAVE_NAMES = /^(特休|特別休假|病假|事假|喪假|公假|原民假|補休)$/;

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

export function inferLegacyShiftSemanticType(shift = {}) {
  const code = normalized(shift.code);
  const name = normalized(shift.name);
  const text = `${code} ${name}`;
  const zeroTime = normalized(shift.startTime) === normalized(shift.endTime);

  if (code === '國' || code === '国' || /^(國定假日|国定假日)$/.test(name)) {
    return 'holiday';
  }
  if (LEAVE_CODES.has(code) || LEAVE_NAMES.test(name)) {
    return 'leave';
  }
  if (code === '例' || /^(例|例假|例假日)$/.test(name)) {
    return 'regular_rest';
  }
  if (zeroTime && (/REGULAR[_ -]?REST/.test(text) || /(?:^|[_-])例$/.test(code))) {
    return 'regular_rest';
  }
  if (code === '休' || code === 'OFF' || code === 'REST' || /^(休|休假|休息日)$/.test(name)) {
    return 'rest_day';
  }
  if (zeroTime && (
    /REST[_ -]?DAY/.test(text)
    || /RULE[_ -]?REST(?:$|\s)/.test(text)
    || /(?:^|[_-])休$/.test(code)
  )) {
    return 'rest_day';
  }
  return 'work';
}

export function resolveShiftSemanticType(shift = {}) {
  const explicit = normalized(shift.semanticType).toLowerCase();
  return SHIFT_SEMANTIC_TYPES.has(explicit) ? explicit : inferLegacyShiftSemanticType(shift);
}

export async function migrateMissingShiftSemantics() {
  const collection = AttendanceSetting.collection;
  if (!collection?.findOne || !collection?.updateOne) return 0;
  const setting = await collection.findOne({}, { projection: { shifts: 1 } });
  if (!setting?._id || !Array.isArray(setting.shifts)) return 0;

  let updated = 0;
  const shifts = setting.shifts.map((shift) => {
    const inferred = inferLegacyShiftSemanticType(shift);
    const current = normalized(shift.semanticType).toLowerCase();
    const missing = !SHIFT_SEMANTIC_TYPES.has(current);
    const unsafeLegacyWorkDefault = current === 'work'
      && inferred !== 'work'
      && normalized(shift.startTime) === normalized(shift.endTime);
    if (!missing && !unsafeLegacyWorkDefault) return shift;
    updated += 1;
    return { ...shift, semanticType: inferred };
  });

  if (updated) {
    await collection.updateOne({ _id: setting._id }, { $set: { shifts } });
  }
  return updated;
}
