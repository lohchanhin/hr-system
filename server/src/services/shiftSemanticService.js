import AttendanceSetting from '../models/AttendanceSetting.js';

export const SHIFT_SEMANTIC_TYPES = new Set([
  'work',
  'rest_day',
  'regular_rest',
  'holiday',
  'leave',
]);

// 請假類班別的代碼與名稱。匯入班表時要用同一份清單判斷（scheduleShared 的 IMPORT_LEAVE_CODES），
// 新增請假類型時兩邊要一起改，所以這裡直接匯出。
export const LEAVE_SHIFT_CODES = Object.freeze([
  '特', '病', '事', '喪', '公', '原', '補',
  '公傷', '婚', '生', '檢', '陪', '產', '家',
]);
export const LEAVE_SHIFT_NAMES = Object.freeze([
  '特休', '特別休假', '病假', '事假', '喪假', '公假', '原民假', '補休',
  '公傷假', '婚假', '生理假', '產檢假', '陪產檢假', '分娩假', '家庭照顧假',
]);
const LEAVE_CODE_SET = new Set(LEAVE_SHIFT_CODES);
const LEAVE_NAME_SET = new Set(LEAVE_SHIFT_NAMES);

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

/** 把 8:00、08:00:00 這類寫法統一成 HH:mm 再比較，避免同一個時間因為格式不同而被當成不相等 */
function normalizedTime(value) {
  const text = normalized(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text;
}

export function inferLegacyShiftSemanticType(shift = {}) {
  const code = normalized(shift.code);
  const name = normalized(shift.name);
  const text = `${code} ${name}`;
  const zeroTime = normalizedTime(shift.startTime) === normalizedTime(shift.endTime);

  if (code === '國' || code === '国' || /^(國定假日|国定假日)$/.test(name)) {
    return 'holiday';
  }
  if (LEAVE_CODE_SET.has(code) || LEAVE_NAME_SET.has(name)) {
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
  // 沒有工作時間（例如 00:00-00:00）又不符合任何休息/請假樣式的班別，一律當作請假類，
  // 不可以變成 24 小時的工作班。
  if (hasNoWorkingTime(shift)) {
    return 'leave';
  }
  return 'work';
}

export function resolveShiftSemanticType(shift = {}) {
  const explicit = normalized(shift.semanticType).toLowerCase();
  return SHIFT_SEMANTIC_TYPES.has(explicit) ? explicit : inferLegacyShiftSemanticType(shift);
}

const NON_WORK_SEMANTIC_TYPES = new Set(['rest_day', 'regular_rest', 'holiday', 'leave']);

/** 休息日、例假、國定假日、請假：這些班別性質都不是工作時段 */
export function isNonWorkSemanticType(type) {
  return NON_WORK_SEMANTIC_TYPES.has(String(type || '').trim().toLowerCase());
}

/**
 * 開始時間等於結束時間、而且沒有勾跨日的班別（例如 00:00-00:00）沒有任何工作時間。
 * 不論班別性質為何都不該被當成 24 小時的班。
 */
export function hasNoWorkingTime(shift = {}) {
  const start = normalizedTime(shift.startTime);
  const end = normalizedTime(shift.endTime);
  return Boolean(start) && start === end && !shift.crossDay;
}

/** 這個班別是否「不用上班」（休息日 / 例假 / 國定假日 / 請假 / 沒有工作時間） */
export function isNonWorkShift(shift = {}) {
  return isNonWorkSemanticType(resolveShiftSemanticType(shift)) || hasNoWorkingTime(shift);
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
    // 班別性質被預設成 work、但開始等於結束（沒有工作時間）的休息/請假班要修正；
    // 有工作時間的班別一律不動，所以重複執行也不會再有變動。
    const unsafeLegacyWorkDefault = current === 'work'
      && inferred !== 'work'
      && normalizedTime(shift.startTime) === normalizedTime(shift.endTime);
    if (!missing && !unsafeLegacyWorkDefault) return shift;
    updated += 1;
    return { ...shift, semanticType: inferred };
  });

  if (updated) {
    await collection.updateOne({ _id: setting._id }, { $set: { shifts } });
  }
  return updated;
}
