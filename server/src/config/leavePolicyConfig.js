/**
 * 假別額度與餘額的預設規則（勞動基準法、勞工請假規則、性別平等工作法的法定天數換成小時，1 天 = 8 小時）。
 * 這些只是「預設值」：管理員可以在「請假與加班設定」調整額度、超額處理與顯示方式，
 * 調整後存在其他控制設定的 leavePolicy 區塊（沒有存過就一律用這裡的預設值）。
 * 法定額度僅供參考，實際以公司規章與主管機關公告為準。
 */
import { LEAVE_DAY_EQUIVALENT_HOURS } from '../utils/leaveHours.js'

export const LEAVE_POLICY_VERSION = 1

// 特休的各種寫法：與 leaveRequestDays.isAnnualLeaveType（扣減特休）使用同一份，顯示的餘額與實際扣減的假別不會分岔
export const ANNUAL_LEAVE_TYPE_ALIASES = ['特休', '特休假', '特別休假']

// 舊資料「年度特休總天數」的數字大於這個值就不可能是天數（法定上限 30 天，公司再給也到不了 40 天），視為已經是小時
export const LEGACY_ANNUAL_LEAVE_DAYS_MAX = 40

// 計算期間：year 每年（曆年 1/1-12/31）、event 每次事件的上限（婚假、喪假…）、none 不設上限
export const LEAVE_PERIODS = ['year', 'event', 'none']
// 額度來源：policy 依這份規則、employee_annual 依員工資料的特休、employee_comp 依員工資料的補休（人資維護）
export const LEAVE_SOURCES = ['policy', 'employee_annual', 'employee_comp']
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
      name: '補休',
      aliases: ['補休假'],
      source: 'employee_comp',
      enforcement: 'none',
      display: 'when_used',
      note: '依員工資料的補休時數，由人資維護',
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
      quotaHours: hoursOf(1),
      period: 'year',
      display: 'when_used',
      note: '每年 1 日，原住民族歲時祭儀',
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
