import FormField from '../models/form_field.js';
import { BONUS_FIELDS, BONUS_FORM_NAMES } from '../config/salaryConfig.js';
import { normalizeLeaveFieldLabel } from './leaveFieldLabels.js';
import { orderFieldCandidateIds, pickFieldValue } from './fieldCandidates.js';

// 金額欄位的直接鍵名（舊資料或匯入資料才會用標籤當鍵；一般簽核單的 form_data 以欄位 ID 為鍵）
const AMOUNT_FIELDS = ['amount', '金額', 'bonus', 'bonusAmount', '津貼', '補助', '獎金', 'nightShiftAllowance', 'performanceBonus', 'otherBonuses'];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

function valueText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(' ');
  if (typeof value === 'object') return String(value.label ?? value.name ?? value.value ?? '').trim();
  return String(value).trim();
}

/**
 * 是不是獎金申請表單：只認預設範本「獎金申請」（名稱或 default_key），或表單性質明確是 bonus。
 * 其他表單（特休保留、請假、加班…）的數字欄位絕不能算成獎金。
 */
export function isBonusForm(form) {
  if (!form || typeof form !== 'object') return false;
  if (normalizeName(form.semanticType) === 'bonus') return true;
  const names = BONUS_FORM_NAMES.map(normalizeName);
  return [form.default_key, form.defaultKey, form.name].some((value) => names.includes(normalizeName(value)));
}

/**
 * 只從「直接鍵名」讀金額（amount、金額…）。不再掃描其他欄位找第一個數字：
 * 特休保留的年度「2026」、請假事由「3」都不是金額。
 */
export function extractNumericAmount(formData = {}) {
  for (const field of AMOUNT_FIELDS) {
    if (formData[field] === undefined) continue;
    const amount = toNumber(formData[field]);
    if (amount) return amount;
  }
  return 0;
}

// 依標籤找出獎金申請表單的金額與類型欄位 ID。
// 同標籤的欄位全部列為候選（啟用中的在前、停用的在後）：欄位被停用或換成同標籤的新欄位後，
// 舊申請單的答案還在舊欄位 ID 底下，每一張單各自用第一個有填值的。
function resolveBonusFieldIds(fields) {
  const list = fields || [];
  const pick = (labels) => {
    for (const label of labels) {
      const matches = list.filter((field) => normalizeLeaveFieldLabel(field.label) === normalizeLeaveFieldLabel(label));
      if (matches.length) return orderFieldCandidateIds(matches);
    }
    return [];
  };
  return { amountIds: pick(BONUS_FIELDS.amount), typeIds: pick(BONUS_FIELDS.type) };
}

function fieldsOf(fieldsByForm, formId) {
  if (!fieldsByForm || !formId) return null;
  const fields = fieldsByForm instanceof Map ? fieldsByForm.get(formId) : fieldsByForm[formId];
  return Array.isArray(fields) && fields.length ? fields : null;
}

// 一張核准的獎金申請的金額與類型；找不到金額欄位或沒填就是 0
function readBonusRequest(approval, fields) {
  const data = approval?.form_data || {};
  if (fields) {
    const { amountIds, typeIds } = resolveBonusFieldIds(fields);
    // 欄位 ID 下沒有值時，再看舊資料用標籤當鍵的寫法
    const amount = toNumber(pickFieldValue(data, amountIds)) || extractNumericAmount(data);
    const type = valueText(pickFieldValue(data, typeIds)) || valueText(data.bonusType ?? data.獎金類型 ?? data.type);
    return { amount, type };
  }
  // 沒有欄位定義可用時（呼叫端沒傳 fieldsByForm）：先看直接鍵名；
  // 預設的獎金申請只有一個數字欄位（金額），form_data 裡剛好只有一個數字型別的值時才採用它
  let amount = extractNumericAmount(data);
  if (!amount) {
    const numbers = Object.values(data).filter((value) => typeof value === 'number' && Number.isFinite(value) && value !== 0);
    if (numbers.length === 1) [amount] = numbers;
  }
  return { amount, type: valueText(data.bonusType ?? data.獎金類型 ?? data.type) };
}

/** 單據核准完成的時間：優先取流程紀錄的「全部完成」，其次更新時間、建立時間。 */
export function approvalFinishedAt(approval) {
  const finish = [...(approval?.logs || [])].reverse().find((log) => log?.action === 'finish' && log.at);
  const value = finish?.at ?? approval?.updatedAt ?? approval?.createdAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * 載入獎金申請表單的欄位定義，回傳 Map(formId -> fields)，給 aggregateBonusFromApprovals 的 fieldsByForm 用。
 * form_data 以欄位 ID 為鍵，一定要有欄位定義才知道哪個是金額、哪個是獎金類型。
 */
export async function loadBonusFieldsByForm(approvals = []) {
  const formIds = new Set();
  for (const approval of approvals || []) {
    if (isBonusForm(approval?.form) && approval.form._id) formIds.add(String(approval.form._id));
  }
  const map = new Map();
  if (!formIds.size) return map;
  const fields = (await FormField.find({ form: { $in: Array.from(formIds) } }).lean()) || [];
  for (const field of fields) {
    const key = String(field.form);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(field);
  }
  return map;
}

/**
 * 把已核准的獎金申請加總成薪資要用的獎金項目。
 * - 只處理獎金申請表單，只讀它的金額與獎金類型欄位；其他表單的任何欄位都不會算進來。
 * - 只回傳「有核准金額」的項目；沒有任何獎金申請時回傳空物件，呼叫端不會把員工設定的獎金覆蓋成 0。
 * - 帶入 employee（與 workData）時，核准金額是「加在」員工每月調整設定的獎金（夜班津貼則是加在動態計算值）之上，
 *   回傳的是加總後的數字，直接指定給 customData 不會洗掉原本設定的金額。
 * options：fieldsByForm（loadBonusFieldsByForm 的結果）、employee、workData、range（{ start, end }，依核准日期篩選）。
 */
export function aggregateBonusFromApprovals(approvals = [], options = {}) {
  const { fieldsByForm, employee, workData, range } = options || {};
  const approved = { nightShiftAllowance: 0, performanceBonus: 0, otherBonuses: 0 };

  (approvals || []).forEach((approval) => {
    if (!isBonusForm(approval?.form)) return;
    if (range?.start || range?.end) {
      const finishedAt = approvalFinishedAt(approval);
      if (!finishedAt) return;
      if (range.start && finishedAt < range.start) return;
      if (range.end && finishedAt >= range.end) return;
    }
    const fields = fieldsOf(fieldsByForm, String(approval.form._id ?? ''));
    const { amount, type } = readBonusRequest(approval, fields);
    if (!(amount > 0)) return;

    const text = `${normalizeName(approval.form.name)} ${normalizeName(type)}`;
    if (text.includes('夜班') || text.includes('night')) {
      approved.nightShiftAllowance += amount;
    } else if (text.includes('績效') || text.includes('performance')) {
      approved.performanceBonus += amount;
    } else {
      approved.otherBonuses += amount;
    }
  });

  const adjustments = employee?.monthlySalaryAdjustments || {};
  const baseline = {
    nightShiftAllowance: toNumber(workData?.nightShiftAllowance),
    performanceBonus: toNumber(adjustments.performanceBonus),
    otherBonuses: toNumber(adjustments.otherBonuses),
  };
  const result = {};
  Object.entries(approved).forEach(([key, amount]) => {
    if (amount) result[key] = baseline[key] + amount;
  });
  return result;
}

export default { aggregateBonusFromApprovals, extractNumericAmount, isBonusForm, loadBonusFieldsByForm, approvalFinishedAt };
