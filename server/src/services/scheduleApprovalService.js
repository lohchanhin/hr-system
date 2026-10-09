// 排班頁「相關簽核」清單：範圍內員工的所有簽核單（任何表單、任何狀態），不只是核准的請假單。
// 日曆用的 leaves[]（只含核准的請假）仍由 scheduleQueryController 自己算，這裡只負責 approvals[]。
import ApprovalRequest from '../models/approval_request.js';
import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import { normalizeLeaveFieldLabel, pickLeaveFields } from '../utils/leaveFieldLabels.js';
import { orderFieldCandidateIds, pickFieldValue, resolveCandidateIds, candidateSelectKeys } from '../utils/fieldCandidates.js';
import { explicitSemanticType, isLeaveFormTemplate, isOvertimeFormTemplate } from '../utils/formSemantics.js';
import { TAIPEI_OFFSET_MS, dateKeyToUtcMidnight, toTaipeiDateKey } from '../utils/taipeiTime.js';

// 清單最多回傳幾筆（最新的在前）；超過時由呼叫端加上 X-Approvals-Truncated 標頭
export const SCHEDULE_APPROVAL_LIMIT = 500;
// 資料庫端先撈回來再由程式用台灣日期精準判斷的上限，避免全公司的管理員一次載入所有歷史單據
const DB_FETCH_LIMIT = 5000;
// 還在流程中的單據：不管申請日在哪個月都要看得到
const OPEN_STATUSES = ['pending', 'returned'];
const DELETED_FORM_NAME = '（表單已刪除）';
const NOTE_MAX_LENGTH = 80;
// 備註摘要取哪個欄位的答案：標籤剛好是這些字的優先，其次是標籤含有這些字（例如「申請事由」「補簽原因」）
const NOTE_EXACT_LABELS = new Set(['事由', '原因', '備註', '說明', '內容說明', 'reason', '理由', '用途']);
const NOTE_LABEL_KEYWORDS = ['事由', '原因', '備註', '說明', '理由', 'reason'];

const idOf = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return idOf(value._id);
  return String(value);
};

// 挑中欄位的所有同標籤欄位 ID（啟用中的在前、停用的在後）：欄位被換成同標籤的新欄位後，舊單據的答案還在舊欄位底下
function sameLabelFieldIds(fields, picked) {
  if (!picked) return [];
  const label = normalizeLeaveFieldLabel(picked.label);
  const sameLabel = (fields || []).filter((field) => normalizeLeaveFieldLabel(field.label) === label);
  return orderFieldCandidateIds(sameLabel.length ? sameLabel : [picked]);
}

function noteFieldIds(fields) {
  const exact = [];
  const loose = [];
  (fields || []).forEach((field) => {
    const label = normalizeLeaveFieldLabel(field.label);
    if (NOTE_EXACT_LABELS.has(label)) exact.push(field);
    else if (NOTE_LABEL_KEYWORDS.some((keyword) => label.includes(keyword))) loose.push(field);
  });
  return [...orderFieldCandidateIds(exact), ...orderFieldCandidateIds(loose)];
}

// 備註摘要：第一個有填的事由／原因／備註類欄位的文字答案，最多 80 字
export function pickApprovalNote(formData, noteIds) {
  if (!formData || typeof formData !== 'object') return undefined;
  for (const id of noteIds || []) {
    const value = formData[id];
    const text = typeof value === 'string' ? value.trim() : (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
    if (text) return text.slice(0, NOTE_MAX_LENGTH);
  }
  return undefined;
}

function buildFormInfo({ id, template, fields, leaveForm }) {
  const explicit = explicitSemanticType(template);
  // 請假表單：假勤日曆認定的請假表單（含已停用的），或表單性質是請假（沒有表單性質的舊表單才用名稱推論）
  const isLeave = Boolean(leaveForm) || explicit === 'leave' || (!explicit && Boolean(template) && isLeaveFormTemplate(template));
  const picked = pickLeaveFields(fields);
  // 請假表單與 leaves[] 用同一組候選欄位，兩邊讀到的日期、假別才不會不一樣
  const startIds = leaveForm ? resolveCandidateIds(leaveForm.startIds, leaveForm.startId) : sameLabelFieldIds(fields, picked.startField);
  const endIds = leaveForm ? resolveCandidateIds(leaveForm.endIds, leaveForm.endId) : sameLabelFieldIds(fields, picked.endField);
  const typeIds = !isLeave ? []
    : (leaveForm ? resolveCandidateIds(leaveForm.typeIds, leaveForm.typeId) : sameLabelFieldIds(fields, picked.typeField));
  let semanticType = 'general';
  if (isLeave) semanticType = 'leave';
  else if (explicit) semanticType = explicit;
  else if (template && isOvertimeFormTemplate(template)) semanticType = 'overtime';
  return {
    id,
    name: template ? template.name : '',
    category: template?.category ?? '',
    semanticType,
    isLeave,
    startIds,
    endIds,
    typeIds,
    noteIds: noteFieldIds(fields),
  };
}

// 所有表單（含停用的）的名稱、性質與可辨識的日期／假別／事由欄位；表單與欄位都很少，每次整批讀一次即可
async function loadFormCatalog(leaveForms) {
  const [templates, fields] = await Promise.all([
    FormTemplate.find({}).select('name category semanticType').lean(),
    FormField.find({}).select('form label order is_active').lean(),
  ]);
  const fieldsByForm = new Map();
  (fields || []).forEach((field) => {
    const key = idOf(field.form);
    if (!fieldsByForm.has(key)) fieldsByForm.set(key, []);
    fieldsByForm.get(key).push(field);
  });
  const leaveFormById = new Map((leaveForms || []).filter((form) => form?.formId).map((form) => [String(form.formId), form]));

  const catalog = new Map();
  (templates || []).forEach((template) => {
    const id = idOf(template._id);
    catalog.set(id, buildFormInfo({ id, template, fields: fieldsByForm.get(id) || [], leaveForm: leaveFormById.get(id) }));
  });
  // 假勤日曆認定的請假表單一定要在（即使表單清單沒讀到它）
  leaveFormById.forEach((leaveForm, id) => {
    if (!catalog.has(id)) catalog.set(id, buildFormInfo({ id, template: null, fields: fieldsByForm.get(id) || [], leaveForm }));
  });
  return catalog;
}

// 資料庫端的粗篩：單據的日期欄位（字串）與本月重疊。查詢範圍兩邊各放寬一天，精準的台灣日期在程式裡判斷
function buildDateBranch(info, { queryStart, queryEnd }) {
  const { startIds, endIds } = info;
  if (!startIds.length && !endIds.length) return null;
  const inWindow = (id) => ({ [`form_data.${id}`]: { $gte: queryStart, $lt: queryEnd } });
  const conditions = [
    ...startIds.flatMap((startField) => endIds.map((endField) => ({
      [`form_data.${startField}`]: { $lt: queryEnd },
      [`form_data.${endField}`]: { $gte: queryStart },
    }))),
    // 只填了開始或只填了結束的單據當作單日
    ...startIds.map(inWindow),
    ...endIds.map(inWindow),
  ];
  return { form: info.id, $or: conditions };
}

function resolveDateKey(value, isLeave) {
  // 非請假表單的「開始」「結束」欄位可能只是個數字或一般文字（new Date('5') 會被解成 2001-05-01），只認長得像日期的字串
  if (!isLeave) {
    if (typeof value === 'number') return null;
    if (typeof value === 'string' && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value.trim())) return null;
  }
  return toTaipeiDateKey(value);
}

// 單據是否與本月有關：解得出日期的看台灣日期有沒有與本月重疊；沒有日期的看申請日在不在本月，或是還在流程中
function isRelevantToMonth({ startKey, endKey, createdAt, status }, { monthStart, monthEnd }) {
  if (startKey || endKey) {
    const from = startKey || endKey;
    const to = endKey || startKey;
    return from < monthEnd && to >= monthStart;
  }
  const createdKey = toTaipeiDateKey(createdAt);
  if (createdKey && createdKey >= monthStart && createdKey < monthEnd) return true;
  return OPEN_STATUSES.includes(status);
}

function buildApprovalRow(doc, catalog, monthRange) {
  const applicant = doc.applicant_employee;
  // 申請人已被刪除的單據排班頁沒有對應的員工可顯示
  if (!applicant || typeof applicant !== 'object' || applicant._id === undefined) return null;

  const formId = idOf(doc.form);
  const info = catalog.get(formId);
  const isLeave = Boolean(info?.isLeave);
  const startRaw = pickFieldValue(doc.form_data, info?.startIds);
  const endRaw = pickFieldValue(doc.form_data, info?.endIds);
  const startKey = resolveDateKey(startRaw, isLeave);
  const endKey = resolveDateKey(endRaw, isLeave);
  if (!isRelevantToMonth({ startKey, endKey, createdAt: doc.createdAt, status: doc.status }, monthRange)) return null;

  const person = {
    _id: applicant._id,
    name: applicant.name,
    department: applicant.department,
    subDepartment: applicant.subDepartment,
  };
  const row = {
    _id: doc._id,
    applicant_employee: person,
    // 舊版前端讀的欄位
    employee: person,
    form: info
      ? { _id: formId, name: info.name, category: info.category, semanticType: info.semanticType }
      : { _id: formId, name: DELETED_FORM_NAME, category: '', semanticType: 'general' },
    status: doc.status,
    createdAt: doc.createdAt,
    isLeave,
  };
  if (isLeave) {
    const leaveType = pickFieldValue(doc.form_data, info.typeIds);
    if (leaveType !== undefined) row.leaveType = leaveType;
  }
  if (startKey) row.startDate = startRaw;
  if (endKey) row.endDate = endRaw;
  const noteSummary = pickApprovalNote(doc.form_data, info?.noteIds);
  if (noteSummary) row.noteSummary = noteSummary;
  return row;
}

/**
 * 範圍內員工與本月有關的所有簽核單，最新的在前，最多 SCHEDULE_APPROVAL_LIMIT 筆。
 * scopeQuery 是呼叫端算好的員工／部門條件（和請假日曆同一份範圍），這裡不再自己定義誰看得到誰。
 * monthRange 是本月的台灣日期範圍 { monthStart, monthEnd }（[起, 迄)），以及資料庫粗篩用、兩邊各放寬一天的 { queryStart, queryEnd }。
 * 與本月有關：解得出開始／結束日期的（請假單通常都是）看台灣日期有沒有與本月重疊；其餘（含沒填日期的請假單）看申請日是否在本月，或還在流程中（待簽、被退回）。
 */
export async function listScheduleRelatedApprovals({ scopeQuery = {}, leaveForms = [], monthRange }) {
  const catalog = await loadFormCatalog(leaveForms);

  const createdFrom = new Date(dateKeyToUtcMidnight(monthRange.monthStart).getTime() - TAIPEI_OFFSET_MS);
  const createdTo = new Date(dateKeyToUtcMidnight(monthRange.monthEnd).getTime() - TAIPEI_OFFSET_MS);
  const relevance = [
    ...Array.from(catalog.values()).map((info) => buildDateBranch(info, monthRange)).filter(Boolean),
    { createdAt: { $gte: createdFrom, $lt: createdTo } },
    { status: { $in: OPEN_STATUSES } },
  ];
  // 部門條件自己帶一個 $or，要和本月條件的 $or 並存只能用 $and
  const { $or: scopeOr, ...scopeRest } = scopeQuery;
  const filter = { ...scopeRest, $and: [...(scopeOr ? [{ $or: scopeOr }] : []), { $or: relevance }] };

  const selectKeys = candidateSelectKeys(
    ...Array.from(catalog.values()).map((info) => [...info.startIds, ...info.endIds, ...info.typeIds, ...info.noteIds]),
  ).map((id) => `form_data.${id}`);
  const docs = await ApprovalRequest.find(filter)
    .select(['applicant_employee', 'form', 'status', 'createdAt', ...selectKeys].join(' '))
    .populate({ path: 'applicant_employee', select: 'name department subDepartment' })
    .sort({ createdAt: -1, _id: -1 })
    .limit(DB_FETCH_LIMIT + 1)
    .lean();

  let truncated = docs.length > DB_FETCH_LIMIT;
  const rows = [];
  for (const doc of docs.slice(0, DB_FETCH_LIMIT)) {
    const row = buildApprovalRow(doc, catalog, monthRange);
    if (row) rows.push(row);
  }
  if (rows.length > SCHEDULE_APPROVAL_LIMIT) truncated = true;
  return { approvals: rows.slice(0, SCHEDULE_APPROVAL_LIMIT), truncated };
}
