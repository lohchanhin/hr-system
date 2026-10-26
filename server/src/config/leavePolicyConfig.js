/**
 * 假別額度與餘額的預設規則（勞動基準法、勞工請假規則、性別平等工作法的法定天數換成小時，1 天 = 8 小時）。
 * 這些只是「預設值」：管理員可以在「請假與加班設定」調整額度、超額處理與顯示方式，
 * 調整後存在其他控制設定的 leavePolicy 區塊（沒有存過就一律用這裡的預設值）。
 * 法定額度僅供參考，實際以公司規章與主管機關公告為準。
 */
import { LEAVE_DAY_EQUIVALENT_HOURS } from '../utils/leaveHours.js'

export const LEAVE_POLICY_VERSION = 1

// 特休的各種寫法：與 leaveRequestDays.isAnnualLeaveType（扣減特休）、salaryConfig.ANNUAL_LEAVE_TYPES（特休統計報表、薪資對照表）使用同一份名稱，
// 顯示的餘額、實際扣減的假別與特休報表不會分岔（salaryConfigLeavePay.test.js 會比對兩份清單）
export const ANNUAL_LEAVE_TYPE_ALIASES = ['特休', '特休假', '特別休假']

// 舊資料「年度特休總天數」的數字大於這個值就不可能是天數（法定上限 30 天，公司再給也到不了 40 天），視為已經是小時
export const LEGACY_ANNUAL_LEAVE_DAYS_MAX = 40

// 調休（國定假日適逢休息日／例假存入的調休存摺）的名稱：簽核單的假別寫「調休」「補休」「補假」都從存摺扣用。
// 客戶把它叫做「移休」（2026/10「迦南人資系統-重大調整」），所以「移休」「移休假」也是固定的別名。
// 名稱固定（管理員不能改掉），否則員工選的假別會對不到存摺、送出時就不會檢查餘額
export const COMP_LEAVE_TYPE_NAME = '調休'
export const COMP_LEAVE_TYPE_ALIASES = ['補休', '補休假', '補假', '調休假', '移休', '移休假']

// 調休存摺的預設：每筆 8 小時、不設期限（0 = 不設期限；設定 N 個月時，從取得日起算 N 個月，過期的時數不列入餘額）
export const DEFAULT_COMPENSATION_HOURS_PER_CREDIT = 8
export const MAX_COMPENSATION_HOURS_PER_CREDIT = 24
export const MAX_COMPENSATION_EXPIRY_MONTHS = 60

// 計算期間：year 每年（曆年 1/1-12/31）、event 每次事件的上限（婚假、喪假…）、none 不設上限
export const LEAVE_PERIODS = ['year', 'event', 'none']
// 額度來源：policy 依這份規則、employee_annual 依員工資料的特休、comp_bank 依調休存摺（系統累計，人資可手動調整）
export const LEAVE_SOURCES = ['policy', 'employee_annual', 'comp_bank']
// 超額處理：block 超額不能送出、warn 超額仍可送出但顯示警告、none 不檢查
export const LEAVE_ENFORCEMENTS = ['block', 'warn', 'none']
// 顯示方式：always 一律顯示、when_used 有使用或簽核中才顯示（或字典有這個假別）、hidden 不顯示
export const LEAVE_DISPLAYS = ['always', 'when_used', 'hidden']

export const MIN_UNIT_HOUR_CHOICES = [0.25, 0.5, 1]
export const MAX_HOURS_PER_DAY_RANGE = { min: 1, max: 24 }

const hoursOf = (days) => days * LEAVE_DAY_EQUIVALENT_HOURS

function type(definition) {
  return {
    aliases: [],
    quotaHours: null,
    period: 'year',
    source: 'policy',
    enforcement: 'warn',
    display: 'always',
    countsAgainst: null,
    builtin: true,
    enabled: true,
    note: '',
    // 適用對象：null 全體員工；'indigenous' 限具原住民身分者（其他員工額度為 0）
    eligibility: null,
    ...definition,
  }
}

export const DEFAULT_LEAVE_POLICY = {
  version: LEAVE_POLICY_VERSION,
  yearBasis: 'calendar',
  // 單日最多可請的時數（表單的每日上限）；12 小時輪班的單位可以調成 12
  maxHoursPerDay: LEAVE_DAY_EQUIVALENT_HOURS,
  // 請假時數的最小單位（小時）
  minUnitHours: 0.5,
  // 調休存摺：國定假日適逢休息日／例假時每筆存入幾小時、期限幾個月（0 = 不設期限）
  compensationHoursPerCredit: DEFAULT_COMPENSATION_HOURS_PER_CREDIT,
  compensationExpiryMonths: 0,
  types: [
    type({
      key: 'annual',
      name: '特休',
      aliases: ['特休假', '特別休假'],
      source: 'employee_annual',
      enforcement: 'block',
      note: '依員工資料的年度特休時數（勞基法第 38 條）',
    }),
    type({
      key: 'comp',
      name: COMP_LEAVE_TYPE_NAME,
      aliases: [...COMP_LEAVE_TYPE_ALIASES],
      source: 'comp_bank',
      enforcement: 'block',
      period: 'none',
      display: 'when_used',
      note: '調休存摺：國定假日適逢休息日／例假自動存入，人資可手動給予或扣除；超過可用時數不能送出',
    }),
    type({
      key: 'personal',
      name: '事假',
      aliases: ['事假申請'],
      quotaHours: hoursOf(14),
      note: '每年 14 日，不給薪（勞工請假規則第 7 條）',
    }),
    type({
      key: 'family_care',
      name: '家庭照顧假',
      aliases: ['家庭照顧'],
      quotaHours: hoursOf(7),
      countsAgainst: { key: 'personal', exemptHours: 0 },
      note: '每年 7 日，併入事假計算（性別平等工作法第 20 條）',
    }),
    type({
      key: 'sick',
      name: '病假',
      aliases: ['普通傷病假', '傷病假'],
      quotaHours: hoursOf(30),
      note: '未住院每年 30 日，半薪（勞工請假規則第 4 條）',
    }),
    type({
      key: 'menstrual',
      name: '生理假',
      aliases: ['生理期假'],
      quotaHours: hoursOf(12),
      countsAgainst: { key: 'sick', exemptHours: hoursOf(3) },
      note: '每月 1 日，全年 3 日內不併入病假，超過部分併入病假計算（性別平等工作法第 14 條）',
    }),
    type({
      key: 'marriage',
      name: '婚假',
      quotaHours: hoursOf(8),
      period: 'event',
      display: 'when_used',
      note: '每次 8 日（勞工請假規則第 2 條）',
    }),
    type({
      key: 'bereavement',
      name: '喪假',
      quotaHours: hoursOf(8),
      period: 'event',
      display: 'when_used',
      note: '每次最多 8 日，依親屬關係 3 至 8 日（勞工請假規則第 3 條）',
    }),
    type({
      key: 'prenatal',
      name: '產檢假',
      aliases: ['產檢'],
      quotaHours: hoursOf(7),
      period: 'event',
      display: 'when_used',
      note: '每次懷孕 7 日（性別平等工作法第 15 條）',
    }),
    type({
      key: 'paternity',
      name: '陪產檢及陪產假',
      aliases: ['陪產檢假', '陪產假', '陪產'],
      quotaHours: hoursOf(7),
      period: 'event',
      display: 'when_used',
      note: '每次 7 日（性別平等工作法第 15 條）',
    }),
    type({
      key: 'maternity',
      name: '分娩假',
      aliases: ['產假'],
      quotaHours: hoursOf(56),
      period: 'event',
      display: 'when_used',
      note: '分娩前後合計 8 星期（性別平等工作法第 15 條）',
    }),
    type({
      key: 'indigenous',
      name: '原民假',
      aliases: ['原住民歲時祭儀假'],
      quotaHours: hoursOf(3),
      period: 'year',
      display: 'when_used',
      eligibility: 'indigenous',
      note: '原住民族歲時祭儀，每年 3 日（限具原住民身分者；紀念日及節日實施條例）',
    }),
    type({
      key: 'official',
      name: '公假',
      period: 'none',
      enforcement: 'none',
      display: 'when_used',
      note: '不設上限',
    }),
    type({
      key: 'work_injury',
      name: '公傷病假',
      aliases: ['公傷假', '職災假', '職災病假'],
      period: 'none',
      enforcement: 'none',
      display: 'when_used',
      note: '職業災害醫療期間，不設上限',
    }),
    type({
      key: 'unpaid',
      name: '無薪假',
      aliases: ['無薪休假', '留職停薪', '育嬰留職停薪'],
      period: 'none',
      enforcement: 'none',
      display: 'when_used',
      note: '不設上限',
    }),
  ],
}

export function cloneDefaultLeavePolicy() {
  return JSON.parse(JSON.stringify(DEFAULT_LEAVE_POLICY))
}

export default {
  LEAVE_POLICY_VERSION,
  ANNUAL_LEAVE_TYPE_ALIASES,
  COMP_LEAVE_TYPE_NAME,
  COMP_LEAVE_TYPE_ALIASES,
  DEFAULT_COMPENSATION_HOURS_PER_CREDIT,
  MAX_COMPENSATION_HOURS_PER_CREDIT,
  MAX_COMPENSATION_EXPIRY_MONTHS,
  LEGACY_ANNUAL_LEAVE_DAYS_MAX,
  LEAVE_PERIODS,
  LEAVE_SOURCES,
  LEAVE_ENFORCEMENTS,
  LEAVE_DISPLAYS,
  MIN_UNIT_HOUR_CHOICES,
  MAX_HOURS_PER_DAY_RANGE,
  DEFAULT_LEAVE_POLICY,
  cloneDefaultLeavePolicy,
}
