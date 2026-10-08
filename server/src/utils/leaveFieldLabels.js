// 請假表單欄位的標籤辨識（寬鬆比對）。
// 純函式、不依賴資料庫模型，讓請假檢核、假勤日曆、薪資、報表都用同一套規則找出開始、結束、假別與天數欄位；
// leaveFieldService 也從這裡取用並重新匯出，行為與先前相同。

// 全形轉半形、轉小寫、去掉所有空白與全/半形括號，「日期（起）」「日期 (起)」都會變成「日期起」
export function normalizeLeaveFieldLabel(label) {
  return String(label ?? '').normalize('NFKC').toLowerCase().replace(/[\s()]/g, '');
}

const START_LABELS = new Set(['開始時間', '開始日期', '日期起', '起始時間', '起始日期', '請假起日', '開始']);
const END_LABELS = new Set(['結束時間', '結束日期', '日期迄', '日期訖', '終止時間', '終止日期', '請假迄日', '結束']);
const DAYS_LABELS = new Set(['天數', '請假天數', '日數', '請假日數']);

export function isLeaveStartLabel(label) {
  return START_LABELS.has(normalizeLeaveFieldLabel(label));
}

export function isLeaveEndLabel(label) {
  return END_LABELS.has(normalizeLeaveFieldLabel(label));
}

// 「假別」或任何以「假別」開頭的標籤，例如「假別類別 (C12)」
export function isLeaveTypeLabel(label) {
  return normalizeLeaveFieldLabel(label).startsWith('假別');
}

export function isLeaveDaysLabel(label) {
  return DAYS_LABELS.has(normalizeLeaveFieldLabel(label));
}

// 同名欄位時優先採用啟用中的；欄位依 order 排好後取第一個
function pickField(fields, matchesLabel) {
  const matches = fields.filter((field) => matchesLabel(field.label));
  return matches.find((field) => field.is_active !== false) ?? matches[0];
}

/**
 * 從一張表單的欄位清單挑出請假用的欄位。
 * 標籤剛好是「假別」的優先，其次才是「假別類別 (C12)」這類以假別開頭的。
 */
export function pickLeaveFields(fields) {
  const ordered = [...(fields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    startField: pickField(ordered, isLeaveStartLabel),
    endField: pickField(ordered, isLeaveEndLabel),
    typeField: pickField(ordered, (label) => normalizeLeaveFieldLabel(label) === '假別')
      ?? pickField(ordered, isLeaveTypeLabel),
    daysField: pickField(ordered, isLeaveDaysLabel),
  };
}
