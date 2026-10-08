import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';
import { resolveFieldOptions } from './formFieldOptionsService.js';
import {
  normalizeLeaveFieldLabel,
  isLeaveStartLabel,
  isLeaveEndLabel,
  isLeaveTypeLabel,
  isLeaveDaysLabel,
  pickLeaveFields,
} from '../utils/leaveFieldLabels.js';
import { orderFieldCandidateIds } from '../utils/fieldCandidates.js';

// 請假表單與欄位的對應結果會被快取；表單或欄位異動時由 approvalTemplateController 呼叫 resetLeaveFieldCache。
// 加上存活時間，多個程序（例如 PM2 多個 worker）時，別的程序改了表單也會在一段時間內自行更新。
// 快取的是「所有候選請假表單依固定順序排好的欄位對應」，getLeaveFieldIds（挑一張）與 getAllLeaveFieldInfos（全部）共用。
const LEAVE_FIELD_CACHE_TTL_MS = 60 * 1000;
// 系統預設的請假表單名稱；多張請假表單並存時，它永遠排第一
const DEFAULT_LEAVE_FORM_NAME = '請假';

let leaveFieldCache = null;
let leaveFieldCacheGeneration = 0;

function normalizeOption(value, label) {
  if (value === undefined || value === null) return null;
  const normalizedValue = String(value);
  const normalizedLabel = label !== undefined && label !== null ? String(label) : normalizedValue;
  return { value: normalizedValue, label: normalizedLabel };
}

function extractOptions(field) {
  const { options } = field ?? {};
  if (!options) return [];

  const results = [];
  const pushOption = (value, label) => {
    const option = normalizeOption(value, label);
    if (option) results.push(option);
  };

  if (Array.isArray(options)) {
    options.forEach((opt) => {
      if (opt === undefined || opt === null) return;
      if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
        pushOption(opt, opt);
      } else if (typeof opt === 'object') {
        const value = opt.value ?? opt.code ?? opt.id ?? opt._id ?? opt.key;
        const label =
          opt.label ?? opt.name ?? opt.title ?? opt.text ?? opt.display ?? opt.caption ?? value;
        pushOption(value ?? label, label ?? value);
      }
    });
  } else if (typeof options === 'object') {
    if (Array.isArray(options.choices)) {
      options.choices.forEach((choice) => {
        if (choice === undefined || choice === null) return;
        if (typeof choice === 'string' || typeof choice === 'number') {
          pushOption(choice, choice);
        } else if (typeof choice === 'object') {
          const value = choice.value ?? choice.code ?? choice.id ?? choice._id ?? choice.key;
          const label =
            choice.label ?? choice.name ?? choice.title ?? choice.text ?? choice.display ?? value;
          pushOption(value ?? label, label ?? value);
        }
      });
    } else {
      Object.entries(options).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (typeof value === 'string' || typeof value === 'number') {
          pushOption(key, value);
        } else if (typeof value === 'object') {
          const optValue = value.value ?? value.code ?? value.id ?? value._id ?? key;
          const optLabel =
            value.label ?? value.name ?? value.title ?? value.text ?? value.display ?? value.value;
          pushOption(optValue ?? optLabel ?? key, optLabel ?? optValue ?? key);
        } else {
          pushOption(key, value);
        }
      });
    }
  }

  const seen = new Set();
  return results.filter((opt) => {
    if (seen.has(opt.value)) return false;
    seen.add(opt.value);
    return true;
  });
}

/* ---------------------- 欄位標籤辨識（寬鬆比對） ---------------------- */

// 標籤辨識規則放在 utils/leaveFieldLabels.js（純函式，請假檢核等不經過本服務的地方也用同一套）；這裡重新匯出，呼叫端不受影響
export {
  normalizeLeaveFieldLabel,
  isLeaveStartLabel,
  isLeaveEndLabel,
  isLeaveTypeLabel,
  isLeaveDaysLabel,
};

// 挑中欄位的所有同標籤欄位 ID（啟用中的在前、停用的在後）。
// 欄位被停用或換成同標籤的新欄位後，舊單據的答案還在舊欄位 ID 底下，讀取端要逐張單據用第一個有填值的。
function sameLabelFieldIds(fields, picked) {
  if (!picked) return [];
  const label = normalizeLeaveFieldLabel(picked.label);
  const sameLabel = (fields || []).filter((field) => normalizeLeaveFieldLabel(field.label) === label);
  return orderFieldCandidateIds(sameLabel.length ? sameLabel : [picked]);
}

function buildLeaveFieldBase(form, fields) {
  const { startField, endField, typeField, daysField } = pickLeaveFields(fields);

  return {
    formId: form._id?.toString(),
    // 停用（含軟刪除）的表單仍保留在這裡：已核准的假單要繼續算進日曆與薪資，由呼叫端依 isActive 決定要不要用
    isActive: form.is_active !== false,
    startId: startField?._id?.toString(),
    endId: endField?._id?.toString(),
    typeId: typeField?._id?.toString(),
    daysId: daysField?._id?.toString(),
    // Store the actual field labels for reference
    startLabel: startField?.label,
    endLabel: endField?.label,
    typeLabel: typeField?.label,
    // 同標籤的候選欄位 ID（第一個就是上面的 startId 等）
    startIds: sameLabelFieldIds(fields, startField),
    endIds: sameLabelFieldIds(fields, endField),
    typeIds: sameLabelFieldIds(fields, typeField),
    daysIds: sameLabelFieldIds(fields, daysField),
    // 假別欄位本身：選項要等到使用時才解析（連結字典的欄位選項會隨字典改變）
    typeField,
  };
}

// 假別選項用解析後的選項（連結字典的欄位取字典目前的項目）
async function resolveTypeOptions(typeField) {
  if (!typeField) return [];
  try {
    return extractOptions(await resolveFieldOptions(typeField));
  } catch (error) {
    return extractOptions(typeField);
  }
}

// withTypeOptions: false 給只需要欄位 ID 的呼叫端（例如假勤日曆），省下解析字典選項的查詢
// withCandidates: true 才附上 isActive 與同標籤候選欄位（startIds…）；getLeaveFieldIds 的回傳形狀維持不變
async function toLeaveFieldInfo(base, { withTypeOptions = true, withCandidates = false } = {}) {
  const { typeField, isActive, startIds, endIds, typeIds, daysIds, ...fieldInfo } = base;
  const info = withCandidates ? { ...fieldInfo, isActive, startIds, endIds, typeIds, daysIds } : fieldInfo;
  if (!withTypeOptions) return info;
  return { ...info, typeOptions: await resolveTypeOptions(typeField) };
}

function hasAllLeaveFields(base) {
  return Boolean(base.startId && base.endId && base.typeId);
}

function timeOf(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : Infinity;
}

// 候選請假表單的固定排序：啟用中的表單在前、停用（含軟刪除）的在後；
// 同樣是啟用或停用時，名稱剛好是「請假」的預設表單最優先，其餘依建立時間、_id 由舊到新。
// 不用 updatedAt：管理員每儲存一次表單它就會變，會讓「挑中哪一張」跟著來回翻轉（預設的請假被新存檔的表單擠掉）。
function compareLeaveForms(a, b) {
  const aInactive = a.is_active === false ? 1 : 0;
  const bInactive = b.is_active === false ? 1 : 0;
  if (aInactive !== bInactive) return aInactive - bInactive;
  const aDefault = a.name === DEFAULT_LEAVE_FORM_NAME ? 0 : 1;
  const bDefault = b.name === DEFAULT_LEAVE_FORM_NAME ? 0 : 1;
  if (aDefault !== bDefault) return aDefault - bDefault;
  const aTime = timeOf(a.createdAt);
  const bTime = timeOf(b.createdAt);
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aId = String(a._id ?? '');
  const bId = String(b._id ?? '');
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

// 所有候選請假表單（依 compareLeaveForms 排序）的欄位對應；沒有候選表單回傳空陣列。
// 停用（含軟刪除）的請假表單也要包含：它底下已核准的假單仍然有效，假勤日曆、薪資、報表、重疊檢查都要看得到；
// 「新的假單要用哪一張表單」（getLeaveFieldIds）才只看啟用中的。
async function findLeaveFieldBases() {
  // 表單性質有設定時以它為準（管理員設成「一般」的表單，即使名稱叫「請假」也不算請假單）；
  // 只有完全沒有表單性質的舊表單才用名稱推論
  let formQuery = FormTemplate.find({
    $or: [
      { semanticType: 'leave' },
      { semanticType: null, name: DEFAULT_LEAVE_FORM_NAME },
      { semanticType: null, name: /leave/i },
    ],
  });
  if (formQuery && typeof formQuery.sort === 'function') {
    formQuery = formQuery.sort({ createdAt: 1, _id: 1 });
  }
  const queried = (formQuery && typeof formQuery.lean === 'function' ? await formQuery.lean() : await formQuery) || [];
  if (!queried.length) return [];
  const forms = [...queried].sort(compareLeaveForms);

  const fields = await FormField.find({ form: { $in: forms.map((form) => form._id) } }).lean();
  const fieldsByForm = new Map();
  (fields || []).forEach((field) => {
    const key = field.form?.toString();
    if (!fieldsByForm.has(key)) fieldsByForm.set(key, []);
    fieldsByForm.get(key).push(field);
  });

  return forms.map((form) => buildLeaveFieldBase(form, fieldsByForm.get(form._id?.toString()) || []));
}

async function loadLeaveFieldBases() {
  if (leaveFieldCache && leaveFieldCache.expiresAt > Date.now()) return leaveFieldCache.bases;

  const generation = leaveFieldCacheGeneration;
  const bases = await findLeaveFieldBases();
  // 查詢期間表單剛好被異動（快取被清掉）就不要把舊結果寫回快取
  if (generation === leaveFieldCacheGeneration) {
    leaveFieldCache = { bases, expiresAt: Date.now() + LEAVE_FIELD_CACHE_TTL_MS };
  }
  return bases;
}

export function resetLeaveFieldCache() {
  leaveFieldCache = null;
  leaveFieldCacheGeneration += 1;
}

/**
 * 只需要「一張」請假表單的呼叫端用（回傳形狀不變）。
 * 多張候選表單時，優先選開始、結束、假別三個欄位都辨識得出來的；同樣完整就取排序在前的
 * （名稱為「請假」的預設表單最優先，之後依建立時間），不受表單被重新儲存的影響。
 * 只看啟用中的表單：這是「新的假單用哪一張表單」，已停用（含軟刪除）的表單不能再被挑中；
 * 要讀既有假單的地方（日曆、薪資、報表）請用 getAllLeaveFieldInfos，它也包含停用的表單。
 */
export async function getLeaveFieldIds() {
  const bases = (await loadLeaveFieldBases()).filter((base) => base.isActive);
  const base = bases.find(hasAllLeaveFields) ?? bases[0] ?? {};
  return base.formId ? toLeaveFieldInfo(base) : base;
}

/**
 * 所有請假表單的欄位對應（預設的「請假」加上客戶自建的請假表單），只保留開始與結束欄位都辨識得出來的，
 * 順序固定（啟用中的在前，其中名稱為「請假」的預設表單在最前，停用的表單排在最後）。
 * 假勤日曆、排班衝突、薪資等要看「所有請假」的地方用這個，對每張表單各查一次核准的假單即可。
 * 停用（含軟刪除）的表單也會回傳，以 isActive: false 標示：已核准的假單不能因為表單被停用就消失。
 * 每筆另附同標籤的候選欄位 startIds / endIds / typeIds / daysIds（啟用中的在前、停用的在後），
 * 讀取端逐張單據用第一個有填值的，欄位被停用或換成同標籤的新欄位後舊單據才讀得到。
 * 快取與失效方式和 getLeaveFieldIds 完全相同。
 * options.withTypeOptions 設為 false 可省去解析假別選項（字典）的查詢。
 */
export async function getAllLeaveFieldInfos(options = {}) {
  const bases = await loadLeaveFieldBases();
  const usable = bases.filter((base) => base.formId && base.startId && base.endId);
  return Promise.all(usable.map((base) => toLeaveFieldInfo(base, { ...options, withCandidates: true })));
}

/**
 * 指定表單的請假欄位對應（不經過快取，也不受「只挑一張請假表單」影響，停用的表單也一樣取得到）。
 * 簽核通過後的特休扣減要用「這張假單所屬表單」的欄位，不能用全域挑中的那一張。
 * 同樣附上 isActive 與同標籤的候選欄位（見 getAllLeaveFieldInfos）。
 */
export async function getLeaveFieldIdsForForm(form) {
  const formId = form && typeof form === 'object' && form._id ? form._id : form;
  if (!formId) return {};
  const fields = await FormField.find({ form: formId }).lean();
  const formInfo = form && typeof form === 'object' && form._id ? form : { _id: formId };
  return toLeaveFieldInfo(buildLeaveFieldBase(formInfo, fields), { withCandidates: true });
}

export async function getLeaveFieldConfig() {
  return getLeaveFieldIds();
}
