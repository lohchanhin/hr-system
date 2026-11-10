// 薪資政策：後台可調整的薪資計算規則（月中到職／離職的月薪比例、加班費倍率、新進員工是否自動計算加班費）。
// - 存在 PayrollPolicy 集合的單一文件（models/PayrollPolicy.js）；沒存的欄位、沒有文件都等於預設值，預設值就是以前寫死的做法，
//   所以沒動過設定的公司薪資結果完全不變。
// - 每一次薪資計算（總覽、明細、計算、存檔、三種匯款 Excel、PDF、個人薪資表）在請求開始時讀一次（loadPayrollPolicy），
//   放進計算用的 context（context.payrollPolicy），整批員工共用同一份；不跨請求快取，PM2 多個程序也不會讀到舊設定。
// - 已儲存的薪資記錄（PayrollRecord）不會因為改設定而重算。
import mongoose from 'mongoose';
import PayrollPolicy from '../models/PayrollPolicy.js';
import Employee from '../models/Employee.js';
import { DEFAULT_OVERTIME_RATES } from '../config/salaryConfig.js';
import { DEFAULT_PRORATION_METHOD, PRORATION_METHOD_KEYS } from '../utils/payrollEmployment.js';

const POLICY_KEY = 'default';
export const DEFAULT_NEW_EMPLOYEE_AUTO_CALC = true;
export const OVERTIME_RATE_MIN = 1;
export const OVERTIME_RATE_MAX = 5;
// 「在職」：自動計算加班費的統計與整批設定（沒有指定員工時）都以「不是離職員工」為準（留職停薪也算在內）
export const ACTIVE_EMPLOYEE_FILTER = Object.freeze({ status: { $ne: '離職員工' } });

export const PRORATION_METHOD_OPTIONS = Object.freeze([
  {
    value: 'days30',
    label: '按 30 天計算',
    description: '月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 30（最多一個月），與月薪換算日薪、時薪的基準相同。',
  },
  {
    value: 'calendarDays',
    label: '按當月日曆天數計算',
    description: '月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 當月天數（28～31 天）。',
  },
  {
    value: 'none',
    label: '不按比例',
    description: '當月只要有在職（哪怕只有一天）就給整個月的月薪；整個月都不在職（尚未到職、已離職、留職停薪且當月沒有班表）仍然沒有本薪。',
  },
]);

const RATE_DEFINITIONS = [
  ['weekdayFirst2', 'workday', '平日加班前 2 小時', '4/3'],
  ['weekdayAfter2', 'workday', '平日加班第 3～4 小時', '5/3'],
  ['restDayFirst2', 'rest_day', '休息日加班前 2 小時', '4/3'],
  ['restDayHours3To8', 'rest_day', '休息日加班第 3～8 小時', '5/3'],
  ['restDayHours9To12', 'rest_day', '休息日加班第 9～12 小時', '8/3'],
  ['holidayWithin8', 'national_holiday', '國定假日出勤 8 小時內（加發一日工資）', '1'],
  ['holidayAfter8First2', 'national_holiday', '國定假日出勤超過 8 小時的前 2 小時', '4/3'],
  ['holidayAfter10', 'national_holiday', '國定假日出勤超過 10 小時的 2 小時', '5/3'],
];

export const OVERTIME_RATE_OPTIONS = Object.freeze(RATE_DEFINITIONS.map(([key, dayType, label, defaultText]) => ({
  key,
  dayType,
  label,
  default: DEFAULT_OVERTIME_RATES[key],
  defaultText,
  min: OVERTIME_RATE_MIN,
  max: OVERTIME_RATE_MAX,
})));
export const OVERTIME_RATE_KEYS = Object.freeze(OVERTIME_RATE_OPTIONS.map((option) => option.key));
const RATE_LABELS = new Map(OVERTIME_RATE_OPTIONS.map((option) => [option.key, option.label]));

// 管理員送來的設定有問題：訊息是繁體中文，由 controller 回 400
export class PayrollPolicyValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayrollPolicyValidationError';
    this.status = 400;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 一份全新的預設政策（每次呼叫都是獨立複本） */
export function getDefaultPayrollPolicy() {
  return {
    proration: { method: DEFAULT_PRORATION_METHOD },
    overtime: { rates: { ...DEFAULT_OVERTIME_RATES }, newEmployeeAutoCalc: DEFAULT_NEW_EMPLOYEE_AUTO_CALC },
  };
}

const sameNumber = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * 倍率：1～5，最多小數兩位，或三分之一的倍數（預設的 4/3、5/3、8/3 沒辦法用兩位小數表示）。
 * 接受數字、數字字串（'1.5'）與分數字串（'4/3'）；回傳整理過的數字，不合格回傳 null。
 */
export function parseOvertimeRate(value) {
  let number = null;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*)?$/.exec(value);
    if (match) number = Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]));
  }
  if (!Number.isFinite(number) || number < OVERTIME_RATE_MIN - 1e-9 || number > OVERTIME_RATE_MAX + 1e-9) return null;
  const hundredths = number * 100;
  if (Math.abs(hundredths - Math.round(hundredths)) < 1e-6) return Math.round(hundredths) / 100;
  const thirds = number * 3;
  if (Math.abs(thirds - Math.round(thirds)) < 1e-6) return Math.round(thirds) / 3;
  return null;
}

/**
 * 資料庫的文件 → { policy, customized }。沒存的欄位用預設值；存的值不合格（手動改壞的資料）也退回預設值，
 * 不讓薪資算出奇怪的數字。customized 標出哪些欄位不是預設值。
 */
export function resolvePayrollPolicy(stored) {
  const policy = getDefaultPayrollPolicy();
  const customized = { prorationMethod: false, overtimeRates: [], newEmployeeAutoCalc: false };
  const source = isPlainObject(stored) ? stored : {};

  const method = source.proration?.method;
  if (PRORATION_METHOD_KEYS.includes(method) && method !== policy.proration.method) {
    policy.proration.method = method;
    customized.prorationMethod = true;
  }
  const rates = isPlainObject(source.overtime?.rates) ? source.overtime.rates : {};
  for (const key of OVERTIME_RATE_KEYS) {
    if (rates[key] === undefined || rates[key] === null) continue;
    const parsed = parseOvertimeRate(rates[key]);
    if (parsed === null || sameNumber(parsed, policy.overtime.rates[key])) continue;
    policy.overtime.rates[key] = parsed;
    customized.overtimeRates.push(key);
  }
  const autoCalc = source.overtime?.newEmployeeAutoCalc;
  if (typeof autoCalc === 'boolean' && autoCalc !== policy.overtime.newEmployeeAutoCalc) {
    policy.overtime.newEmployeeAutoCalc = autoCalc;
    customized.newEmployeeAutoCalc = true;
  }
  return { policy, customized };
}

async function readPolicyDocument() {
  return PayrollPolicy.findOne({ key: POLICY_KEY }).lean();
}

/**
 * 目前生效的薪資政策（每次請求讀一次，交給計算函式的 context.payrollPolicy）。
 * 沒有資料庫連線時（單元測試）回傳預設值；讀取失敗時錯誤照樣往外丟，不會悄悄改用預設值算薪水。
 */
export async function loadPayrollPolicy() {
  if (mongoose.connection.readyState !== 1) return getDefaultPayrollPolicy();
  return resolvePayrollPolicy(await readPolicyDocument()).policy;
}

/** 新增員工沒有指定「自動計算加班費」時用的預設值 */
export async function loadNewEmployeeAutoOvertimeDefault() {
  return (await loadPayrollPolicy()).overtime.newEmployeeAutoCalc;
}

/** 在職（不是離職員工）的員工中，自動計算加班費開啟、關閉的人數 */
export async function countAutoOvertimeCalc() {
  const [on, active] = await Promise.all([
    Employee.countDocuments({ ...ACTIVE_EMPLOYEE_FILTER, autoOvertimeCalc: true }),
    Employee.countDocuments(ACTIVE_EMPLOYEE_FILTER),
  ]);
  return { activeEmployees: active, autoOvertimeCalcOn: on, autoOvertimeCalcOff: Math.max(active - on, 0) };
}

/** GET /api/payroll/policy 的回應：生效的政策、預設值、選項說明、哪些欄位改過、在職員工的開關人數 */
export async function describePayrollPolicy() {
  const document = mongoose.connection.readyState === 1 ? await readPolicyDocument() : null;
  const { policy, customized } = resolvePayrollPolicy(document);
  const stats = await countAutoOvertimeCalc();
  return {
    ...policy,
    defaults: getDefaultPayrollPolicy(),
    customized,
    options: {
      prorationMethods: PRORATION_METHOD_OPTIONS.map((option) => ({ ...option })),
      overtimeRates: OVERTIME_RATE_OPTIONS.map((option) => ({ ...option })),
    },
    stats,
    updatedAt: document?.updatedAt ?? null,
  };
}

function assertKnownKeys(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new PayrollPolicyValidationError(`不認得的設定：${unknown.map((key) => (path ? `${path}.${key}` : key)).join('、')}`);
  }
}

/**
 * 驗證 PUT 的內容（只更新有送的欄位），回傳資料庫的 { $set, $unset }。
 * 送 null 或送預設值都代表「回到預設值」（清掉已存的值）。
 */
export function buildPayrollPolicyUpdate(body) {
  if (!isPlainObject(body)) throw new PayrollPolicyValidationError('薪資設定的格式不正確');
  assertKnownKeys(body, ['proration', 'overtime'], '');
  const defaults = getDefaultPayrollPolicy();
  const $set = {};
  const $unset = {};
  const assign = (path, value, defaultValue, same = (a, b) => a === b) => {
    if (value === null || same(value, defaultValue)) $unset[path] = 1;
    else $set[path] = value;
  };

  if (body.proration !== undefined) {
    if (!isPlainObject(body.proration)) throw new PayrollPolicyValidationError('月中到職、離職的月薪比例（proration）格式不正確');
    assertKnownKeys(body.proration, ['method'], 'proration');
    const { method } = body.proration;
    if (method !== undefined) {
      if (method !== null && !PRORATION_METHOD_KEYS.includes(method)) {
        throw new PayrollPolicyValidationError(`月中到職、離職的月薪比例只能是 ${PRORATION_METHOD_KEYS.join('、')}`);
      }
      assign('proration.method', method, defaults.proration.method);
    }
  }

  if (body.overtime !== undefined) {
    if (!isPlainObject(body.overtime)) throw new PayrollPolicyValidationError('加班設定（overtime）格式不正確');
    assertKnownKeys(body.overtime, ['rates', 'newEmployeeAutoCalc'], 'overtime');
    const { rates, newEmployeeAutoCalc } = body.overtime;
    if (rates !== undefined) {
      if (!isPlainObject(rates)) throw new PayrollPolicyValidationError('加班費倍率（overtime.rates）格式不正確');
      assertKnownKeys(rates, OVERTIME_RATE_KEYS, 'overtime.rates');
      for (const [key, raw] of Object.entries(rates)) {
        if (raw === undefined) continue;
        const parsed = raw === null ? null : parseOvertimeRate(raw);
        if (raw !== null && parsed === null) {
          throw new PayrollPolicyValidationError(
            `「${RATE_LABELS.get(key)}」的倍率必須是 ${OVERTIME_RATE_MIN} 到 ${OVERTIME_RATE_MAX} 之間的數字（最多小數兩位，或 4/3 這類三分之一的倍數）`,
          );
        }
        assign(`overtime.rates.${key}`, parsed, defaults.overtime.rates[key], sameNumber);
      }
    }
    if (newEmployeeAutoCalc !== undefined) {
      if (newEmployeeAutoCalc !== null && typeof newEmployeeAutoCalc !== 'boolean') {
        throw new PayrollPolicyValidationError('新進員工是否自動計算加班費（overtime.newEmployeeAutoCalc）必須是 true 或 false');
      }
      assign('overtime.newEmployeeAutoCalc', newEmployeeAutoCalc, defaults.overtime.newEmployeeAutoCalc);
    }
  }

  if (!Object.keys($set).length && !Object.keys($unset).length) {
    throw new PayrollPolicyValidationError('沒有要更新的設定');
  }
  return { $set, $unset };
}

/**
 * PUT /api/payroll/policy：部分更新（各欄位各自以 $set / $unset 原子寫入，兩個人同時改不同欄位不會互相蓋掉），
 * 回傳更新後的完整描述（同 describePayrollPolicy）。
 */
export async function updatePayrollPolicy(body, { actorId } = {}) {
  const { $set, $unset } = buildPayrollPolicyUpdate(body);
  const update = { $set: { ...$set } };
  if (actorId && mongoose.isValidObjectId(actorId)) update.$set.updatedBy = actorId;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (!Object.keys(update.$set).length) delete update.$set;
  const write = () => PayrollPolicy.findOneAndUpdate({ key: POLICY_KEY }, update, { upsert: true, new: true });
  try {
    await write();
  } catch (error) {
    // 兩個請求同時建立第一份文件：唯一索引擋下其中一個，再寫一次就會更新已建立的那一份
    if (error?.code !== 11000) throw error;
    await write();
  }
  return describePayrollPolicy();
}

/** 啟動時的一行紀錄（只讀、只算筆數；任何錯誤都吞掉，回傳 null） */
export async function describePayrollPolicyForStartup() {
  try {
    const document = await readPolicyDocument();
    const { policy, customized } = resolvePayrollPolicy(document);
    const stats = await countAutoOvertimeCalc();
    return {
      saved: Boolean(document),
      prorationMethod: policy.proration.method,
      prorationCustomized: customized.prorationMethod,
      customizedRates: customized.overtimeRates,
      newEmployeeAutoCalc: policy.overtime.newEmployeeAutoCalc,
      ...stats,
    };
  } catch (error) {
    console.error('Failed to describe payroll policy', error?.name ?? 'Error');
    return null;
  }
}

export default {
  getDefaultPayrollPolicy,
  resolvePayrollPolicy,
  parseOvertimeRate,
  loadPayrollPolicy,
  loadNewEmployeeAutoOvertimeDefault,
  countAutoOvertimeCalc,
  describePayrollPolicy,
  buildPayrollPolicyUpdate,
  updatePayrollPolicy,
  describePayrollPolicyForStartup,
};
