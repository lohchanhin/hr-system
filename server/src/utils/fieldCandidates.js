// 同標籤欄位的取值規則（純函式）。
// 表單欄位被停用，或被換成同標籤的新欄位後，舊單據的答案仍存在舊欄位 ID 底下；
// 讀取已核准單據的地方（假勤日曆、薪資、報表）不能只認啟用中的那一個欄位，
// 要把同標籤的欄位都列為候選（啟用中的在前、停用的在後），每一張單各自用第一個「有填值」的欄位。

// 欄位值算不算「有填」：null / undefined、空字串、只有空白、空陣列都不算；0 與 false 是有填的值
export function hasFieldValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// 一批欄位的候選欄位 ID：啟用中的在前、停用的在後，各自依 order 排序（order 相同維持原順序）
export function orderFieldCandidateIds(fields) {
  const sorted = (fields || [])
    .filter((field) => field && field._id !== undefined && field._id !== null)
    .map((field, index) => ({ field, index }))
    .sort((a, b) => ((a.field.order ?? 0) - (b.field.order ?? 0)) || (a.index - b.index))
    .map(({ field }) => field);
  const active = sorted.filter((field) => field.is_active !== false);
  const inactive = sorted.filter((field) => field.is_active === false);
  return [...active, ...inactive].map((field) => String(field._id));
}

// 呼叫端沒有候選清單（例如只拿到單一欄位 ID）時，退回單一欄位 ID
export function resolveCandidateIds(ids, fallbackId) {
  if (Array.isArray(ids) && ids.length) return ids;
  return fallbackId ? [fallbackId] : [];
}

// 這張單據的 form_data 裡，第一個有填值的候選欄位的值；都沒填回傳 undefined
export function pickFieldValue(formData, ids) {
  if (!formData || typeof formData !== 'object') return undefined;
  for (const id of ids || []) {
    if (hasFieldValue(formData[id])) return formData[id];
  }
  return undefined;
}

// 查詢單據時要一併取回的欄位（Mongo select 用）：所有候選欄位 ID 去重
export function candidateSelectKeys(...idLists) {
  return Array.from(new Set(idLists.flat().filter(Boolean).map(String)));
}

export default { hasFieldValue, orderFieldCandidateIds, resolveCandidateIds, pickFieldValue, candidateSelectKeys };
