// 請假改以「小時」為單位的資料搬移（啟動時執行，冪等、只記錄筆數）：
// 1. migrateAnnualLeaveToHours：員工特休從「天數」欄位搬成「時數」欄位（totalDays / usedDays -> totalHours / usedHours）。
//    單位以「整份資料」判斷（只要有人的數字大於 40，客戶就是把小時填在天數欄位，全部原樣當小時），不是逐人猜；
//    已經用舊規則搬過的資料不會被自動改數字，只會把「可能猜錯」的員工標成待確認（flagGuessedAnnualLeaveUnits）。
// 2. migrateLeaveFormsToHours：請假表單補上「時數」欄位，並把舊的「天數」欄位停用（不刪除，舊假單的答案還在）。
// 放在獨立的模組：startupMigrations.test.js 以原始碼比對 index.js 對 approvalTemplateController 的匯入寫法。
import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
// 用命名空間匯入：別的測試把 leaveFieldService 換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as leaveFieldService from './leaveFieldService.js'
import { interpretLegacyAnnualLeave, usesHoursInDaysColumn } from '../utils/annualLeaveHours.js'
import { LEGACY_ANNUAL_LEAVE_DAYS_MAX } from '../config/leavePolicyConfig.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { isLeaveDaysLabel, isLeaveEndLabel, isLeaveHoursLabel } from '../utils/leaveFieldLabels.js'
import { LEAVE_DAY_EQUIVALENT_HOURS, roundHours } from '../utils/leaveHours.js'

const BATCH_SIZE = 500
const LEGACY_CANDIDATE_FILTER = { annualLeave: { $type: 'object' }, 'annualLeave.totalHours': { $exists: false } }
// 「這份資料的慣例是把小時填在天數欄位」的證據：已有員工判定為小時，或凍結的天數欄位大於 40（不可能是天數）
const HOURS_CONVENTION_EVIDENCE = {
  $or: [
    { 'annualLeave.unitSource': 'migrated-hours' },
    { 'annualLeave.totalDays': { $gt: LEGACY_ANNUAL_LEAVE_DAYS_MAX } },
    { 'annualLeave.usedDays': { $gt: LEGACY_ANNUAL_LEAVE_DAYS_MAX } },
  ],
}

export const HOURS_FIELD_LABEL = '時數'
export const HOURS_FIELD_PLACEHOLDER = '請假時數（小時），0.5 的倍數；系統依起訖時間自動帶入'

function appliedIdsOf(employee) {
  const ids = employee?.annualLeave?.appliedApprovalRequestIds
  return Array.isArray(ids) ? ids.map(String).filter(Boolean) : []
}

/*
 * 舊資料是「小時」的員工（天數欄位的數字大於 40）：系統之前核准特休時把「天數」加進這個其實是小時的計數，
 * 每核准 1 天只加了 1（應該是 8 小時）。已套用的簽核單（appliedApprovalRequestIds）裡確實扣過的天數各補 7 小時，
 * 搬移當下一次寫入，所以只會修正一次。查詢失敗就不修正（寧可少算，由人資在員工管理確認）。
 */
async function repairDeductedDays(employee) {
  const ids = appliedIdsOf(employee)
  if (!ids.length) return 0
  try {
    const rows = await ApprovalRequest.find({ _id: { $in: ids } }).select('annual_leave').lean()
    return (rows || []).reduce((sum, row) => {
      const annual = row?.annual_leave
      if (annual?.state !== 'deducted') return sum
      const days = Number(annual.days)
      return Number.isFinite(days) && days > 0 ? sum + days : sum
    }, 0)
  } catch {
    return 0
  }
}

// 一位員工的搬移結果：{ set, fromDays, repaired }；hoursConvention：整份資料的慣例是小時填在天數欄位
async function buildHoursUpdate(employee, { hoursConvention = false } = {}) {
  const legacy = employee?.annualLeave || {}
  const interpreted = interpretLegacyAnnualLeave(legacy.totalDays, legacy.usedDays, { hoursConvention })
  let usedHours = interpreted.usedHours
  let repaired = false
  if (interpreted.unitSource === 'migrated-hours') {
    const deductedDays = await repairDeductedDays(employee)
    if (deductedDays > 0) {
      usedHours = roundHours(usedHours + deductedDays * (LEAVE_DAY_EQUIVALENT_HOURS - 1))
      repaired = true
    }
  }
  return {
    set: {
      'annualLeave.totalHours': interpreted.totalHours,
      'annualLeave.usedHours': usedHours,
      'annualLeave.unitSource': interpreted.unitSource,
    },
    fromDays: interpreted.unitSource === 'migrated-days',
    repaired,
  }
}

// 這份資料（所有員工）是不是用「小時填在天數欄位」的慣例：待搬移的員工裡有人超過 40，或已搬移的員工裡有證據
async function resolveHoursConvention(candidates) {
  if (usesHoursInDaysColumn((candidates || []).map(employee => employee?.annualLeave))) return true
  return Boolean(await Employee.exists(HOURS_CONVENTION_EVIDENCE))
}

/**
 * 員工特休從天數搬成時數（冪等）：
 * - 找出有 annualLeave 但還沒有 totalHours 的員工，單位以「整份資料」判斷：只要有任何一個人的天數欄位數字大於 40（不可能是天數），
 *   客戶就是把小時填在天數欄位，所有尚未搬移的員工都原樣當成小時（unitSource 為 migrated-hours，員工管理會顯示待確認）；
 *   整份資料都沒有超過 40 的數字才乘 8。兩個數字都是 0 的員工沒有東西要判斷，維持 migrated-days。
 * - 搬完後接著執行 flagGuessedAnnualLeaveUnits：舊規則（逐人判斷）搬過、現在看來可能猜錯的員工標成待確認，數字不動。
 * - 寫入條件再確認一次沒有 totalHours，所以重複或同時執行都不會重複搬；舊的 totalDays / usedDays 保持原狀（供稽核與回復）。
 * - 不更新 updatedAt（不是人工修改；bulkWrite 的 timestamps 選項只管新增／取代，更新要在每一個 updateOne 上關掉）。
 * @returns {Promise<{ migrated: number, fromDays: number, alreadyHours: number, repaired: number, flagged: number }>}
 */
export async function migrateAnnualLeaveToHours() {
  const candidates = await Employee.find(LEGACY_CANDIDATE_FILTER)
    .select('+annualLeave.appliedApprovalRequestIds')
    .lean()
  const result = { migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0, flagged: 0 }

  if (candidates?.length) {
    const hoursConvention = await resolveHoursConvention(candidates)
    for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + BATCH_SIZE)
      const operations = []
      const meta = []
      for (const employee of batch) {
        const update = await buildHoursUpdate(employee, { hoursConvention })
        operations.push({
          updateOne: {
            filter: { _id: employee._id, 'annualLeave.totalHours': { $exists: false } },
            update: { $set: update.set },
            timestamps: false,
          },
        })
        meta.push(update)
      }
      const outcome = await Employee.bulkWrite(operations, { ordered: false, timestamps: false })
      // 條件不符（同時被別的程序搬過）的不算。bulkWrite 只回總筆數，細項（天數換算／本來就是小時／已修正）只在全部寫入成功時統計
      const modified = outcome?.modifiedCount ?? outcome?.nModified ?? meta.length
      result.migrated += modified
      if (modified === meta.length) {
        for (const update of meta) {
          if (update.fromDays) result.fromDays += 1
          else result.alreadyHours += 1
          if (update.repaired) result.repaired += 1
        }
      }
    }
  }

  // 標記失敗不影響搬移本身（數字已經寫入），下次啟動會再試一次
  try {
    result.flagged = await flagGuessedAnnualLeaveUnits()
  } catch (error) {
    console.error('Failed to flag annual leave units for confirmation', error?.name ?? 'Error')
  }
  return result
}

const nonNegativeNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

// 已搬移、單位來源是 migrated-days，而且總時數還是「凍結的天數 x 8」：數字是搬移時猜出來的，沒有人改過
function isGuessedFromDays(employee) {
  const leave = employee?.annualLeave || {}
  const days = nonNegativeNumber(leave.totalDays)
  const usedDays = nonNegativeNumber(leave.usedDays)
  if (days === 0 && usedDays === 0) return false // 沒有資料，沒有東西要確認
  if (Math.max(days, usedDays) > LEGACY_ANNUAL_LEAVE_DAYS_MAX) return false
  return nonNegativeNumber(leave.totalHours) === roundHours(days * LEAVE_DAY_EQUIVALENT_HOURS)
}

// 已搬移的員工裡，數字是用舊規則（逐人判斷）猜成「天數 x 8」的；只在整份資料的慣例是小時時才有意義
async function findGuessedDaysEmployees() {
  if (!(await Employee.exists(HOURS_CONVENTION_EVIDENCE))) return []
  const rows = await Employee.find({ 'annualLeave.unitSource': 'migrated-days', 'annualLeave.totalHours': { $exists: true } })
    .select('annualLeave.totalDays annualLeave.usedDays annualLeave.totalHours annualLeave.usedHours annualLeave.unitSource')
    .lean()
  return (rows || []).filter(isGuessedFromDays)
}

/**
 * 修復旗標（冪等、不動數字）：整份資料已經有人判定為「小時填在天數欄位」時，先前用舊規則（逐人判斷）搬移的員工，
 * 若數字是搬移時由天數乘 8 猜出來的（unitSource 還是 migrated-days，總時數還等於凍結的天數 x 8，沒有人改過），
 * 一樣標成 migrated-hours，員工管理的編輯畫面就會顯示「請確認」，人資可以核對或更正。
 * 只改單位來源，不改 totalHours / usedHours；人資確認或修改後單位來源變成 entered，不會再被標記。
 * 只記錄筆數，不記錄員工資料。
 * @returns {Promise<number>} 這次標記的員工數
 */
export async function flagGuessedAnnualLeaveUnits() {
  const guessed = await findGuessedDaysEmployees()
  if (!guessed.length) return 0
  let flagged = 0
  for (let offset = 0; offset < guessed.length; offset += BATCH_SIZE) {
    const operations = guessed.slice(offset, offset + BATCH_SIZE).map(employee => ({
      updateOne: {
        // 條件再確認一次：期間內被人資改過（單位來源或總時數變了）的不動
        filter: { _id: employee._id, 'annualLeave.unitSource': 'migrated-days', 'annualLeave.totalHours': employee.annualLeave.totalHours },
        update: { $set: { 'annualLeave.unitSource': 'migrated-hours' } },
        timestamps: false,
      },
    }))
    const outcome = await Employee.bulkWrite(operations, { ordered: false, timestamps: false })
    flagged += outcome?.modifiedCount ?? outcome?.nModified ?? 0
  }
  if (flagged) {
    console.log(`Flagged ${flagged} employees for annual leave unit confirmation (this data has hour-sized values in the days column)`)
  }
  return flagged
}

/**
 * 搬移前的預覽（維運腳本 --dry-run）：不寫入。
 * @returns {Promise<{ pending: number, fromDays: number, alreadyHours: number, hoursConvention: boolean, toFlag: number }>}
 */
export async function previewAnnualLeaveMigration() {
  const candidates = await Employee.find(LEGACY_CANDIDATE_FILTER).select('annualLeave.totalDays annualLeave.usedDays').lean()
  const hoursConvention = await resolveHoursConvention(candidates)
  let fromDays = 0
  let alreadyHours = 0
  for (const employee of candidates || []) {
    const interpreted = interpretLegacyAnnualLeave(employee.annualLeave?.totalDays, employee.annualLeave?.usedDays, { hoursConvention })
    if (interpreted.unitSource === 'migrated-hours') alreadyHours += 1
    else fromDays += 1
  }
  return { pending: candidates?.length || 0, fromDays, alreadyHours, hoursConvention, toFlag: (await findGuessedDaysEmployees()).length }
}

/**
 * 給人資核對的清單（維運腳本 --report）：每位「單位是推斷出來的」員工一列，
 * employeeId、name、凍結的舊天數欄位（totalDays / usedDays）、現在的時數（totalHours / usedHours）、unitSource，
 * 以及 reading：現在的總時數相當於舊數字當天數乘 8（days x8）、當小時原值（as hours），或已經被改過（edited）；還沒搬移的是 not-migrated。
 * 人資輸入或確認過（entered）的員工、以及完全沒有特休資料的員工不列。
 * @returns {Promise<{ hoursConvention: boolean, rows: Array<object> }>}
 */
export async function buildAnnualLeaveUnitReport() {
  const employees = await Employee.find({ annualLeave: { $type: 'object' } })
    .select('employeeId name annualLeave.totalDays annualLeave.usedDays annualLeave.totalHours annualLeave.usedHours annualLeave.unitSource')
    .lean()
  const rows = []
  for (const employee of employees || []) {
    const leave = employee.annualLeave || {}
    const totalDays = nonNegativeNumber(leave.totalDays)
    const usedDays = nonNegativeNumber(leave.usedDays)
    const migrated = leave.totalHours !== undefined && leave.totalHours !== null
    const unitSource = migrated ? (leave.unitSource || '') : 'not-migrated'
    if (migrated && !['migrated-days', 'migrated-hours'].includes(unitSource)) continue
    if (totalDays === 0 && usedDays === 0 && !nonNegativeNumber(leave.totalHours) && !nonNegativeNumber(leave.usedHours)) continue
    let reading = 'not-migrated'
    if (migrated) {
      const totalHours = nonNegativeNumber(leave.totalHours)
      if (totalDays > 0 && totalHours === roundHours(totalDays * LEAVE_DAY_EQUIVALENT_HOURS)) reading = 'days x8'
      else if (totalDays > 0 && totalHours === roundHours(totalDays)) reading = 'as hours'
      else reading = 'edited'
    }
    rows.push({
      employeeId: employee.employeeId ?? '',
      name: employee.name ?? '',
      totalDays,
      usedDays,
      totalHours: migrated ? nonNegativeNumber(leave.totalHours) : null,
      usedHours: migrated ? nonNegativeNumber(leave.usedHours) : null,
      unitSource,
      reading,
    })
  }
  rows.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId), 'en', { numeric: true }))
  const hoursConvention = Boolean(await Employee.exists(HOURS_CONVENTION_EVIDENCE)) || usesHoursInDaysColumn(rows)
  return { hoursConvention, rows }
}

/**
 * 單一員工的搬移（扣減、返還、設定特休時發現還是舊格式才用）。回傳這次有沒有真的搬。
 * 這裡只看這一位員工的數字（與讀取「尚未搬移」文件時的解讀一致，不會讀到一個數字、寫進去另一個數字）；
 * 若整份資料的慣例其實是小時，下次啟動時 flagGuessedAnnualLeaveUnits 會把這位員工標成待確認。
 */
export async function ensureAnnualLeaveHours(employeeId) {
  if (!employeeId) return false
  const employee = await Employee.findOne({ _id: employeeId, ...LEGACY_CANDIDATE_FILTER })
    .select('+annualLeave.appliedApprovalRequestIds')
    .lean()
  if (!employee) return false
  const update = await buildHoursUpdate(employee)
  const outcome = await Employee.updateOne(
    { _id: employee._id, 'annualLeave.totalHours': { $exists: false } },
    { $set: update.set },
    { timestamps: false },
  )
  return Boolean(outcome?.modifiedCount ?? outcome?.nModified)
}

function sortedByOrder(fields) {
  return [...(fields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/**
 * 請假表單補上「時數」欄位（每張表單只處理一次，用 leave_hours_migrated 標記）：
 * 1. 還沒有時數欄位（啟用或停用都算有）才新增：必填的數字欄位，放在原本天數欄位的位置，沒有天數欄位就放在結束時間之後。
 * 2. 啟用中的「天數」欄位改成停用（不刪除：舊假單的答案還在，薪資、報表、特休扣減都靠它讀到舊資料）。
 * 3. 最後才寫標記，所以中途失敗再執行會從上次停下的地方繼續；之後管理員自己刪掉時數欄位也不會再被補回。
 * @returns {Promise<{ forms: number, added: number, deactivated: number }>}
 */
export async function migrateLeaveFormsToHours() {
  const pending = await FormTemplate.find({ leave_hours_migrated: { $ne: true } }, { name: 1, semanticType: 1 }).lean()
  const forms = (pending || []).filter(isLeaveFormTemplate)
  const result = { forms: 0, added: 0, deactivated: 0 }
  if (!forms.length) return result

  for (const form of forms) {
    const fields = sortedByOrder(await FormField.find({ form: form._id }).lean())
    const hasHoursField = fields.some(field => isLeaveHoursLabel(field.label))
    const activeDaysFields = fields.filter(field => field.is_active !== false && isLeaveDaysLabel(field.label))

    if (!hasHoursField) {
      const daysField = activeDaysFields[0]
      const endField = fields.filter(field => isLeaveEndLabel(field.label)).pop()
      const maxOrder = fields.reduce((max, field) => Math.max(max, Number(field.order) || 0), 0)
      const order = daysField ? Number(daysField.order) || 0 : (endField ? (Number(endField.order) || 0) + 0.5 : maxOrder + 1)
      await FormField.create({
        form: form._id,
        label: HOURS_FIELD_LABEL,
        type_1: 'number',
        required: true,
        placeholder: HOURS_FIELD_PLACEHOLDER,
        order,
        is_active: true,
      })
      result.added += 1
    }
    if (activeDaysFields.length) {
      await FormField.updateMany(
        { _id: { $in: activeDaysFields.map(field => field._id) }, is_active: { $ne: false } },
        { $set: { is_active: false } },
      )
      result.deactivated += activeDaysFields.length
    }
    await FormTemplate.updateOne(
      { _id: form._id, leave_hours_migrated: { $ne: true } },
      { $set: { leave_hours_migrated: true } },
      { timestamps: false },
    )
    result.forms += 1
  }
  if (typeof leaveFieldService.resetLeaveFieldCache === 'function') leaveFieldService.resetLeaveFieldCache()
  return result
}

export default {
  HOURS_FIELD_LABEL,
  HOURS_FIELD_PLACEHOLDER,
  migrateAnnualLeaveToHours,
  flagGuessedAnnualLeaveUnits,
  previewAnnualLeaveMigration,
  buildAnnualLeaveUnitReport,
  ensureAnnualLeaveHours,
  migrateLeaveFormsToHours,
}
