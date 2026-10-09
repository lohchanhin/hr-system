// 逐張假單決定要讀哪一個欄位 ID（純函式）。
// getLeaveFieldIdsForForm 的 typeId / startId / endId / daysId 是「目前啟用中」的欄位；
// 欄位被停用，或被換成同標籤的新欄位後，還在簽核中或已核准的舊假單，答案仍在舊欄位 ID 底下。
// 這裡把 typeIds / startIds / endIds / daysIds（啟用中的在前、停用的在後）各自挑成「這張假單第一個有填值的欄位」，
// 回傳的形狀與 getLeaveFieldIdsForForm 相同，可直接交給 isAnnualLeaveType、computeLeaveRequestDays、leaveStartInstant。
import { hasFieldValue, resolveCandidateIds } from './fieldCandidates.js';

// 候選欄位裡第一個在 formData 有填值的 ID；都沒填就用預設的（啟用中的）欄位 ID，行為與只認單一欄位時相同
function pickFieldId(formData, ids, fallbackId) {
  for (const id of ids) {
    if (hasFieldValue(formData[id])) return id;
  }
  return fallbackId;
}

export function resolveLeaveFieldsForRequest(leaveFields, formData) {
  const fields = leaveFields || {};
  const data = formData && typeof formData === 'object' ? formData : {};
  const resolve = (ids, fallbackId) => pickFieldId(data, resolveCandidateIds(ids, fallbackId), fallbackId);
  return {
    ...fields,
    typeId: resolve(fields.typeIds, fields.typeId),
    startId: resolve(fields.startIds, fields.startId),
    endId: resolve(fields.endIds, fields.endId),
    daysId: resolve(fields.daysIds, fields.daysId),
  };
}

export default { resolveLeaveFieldsForRequest };
