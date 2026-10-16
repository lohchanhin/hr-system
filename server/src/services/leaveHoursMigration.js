// 請假改以「小時」為單位的資料搬移（啟動時執行，冪等、只記錄筆數）：
// 1. migrateAnnualLeaveToHours：員工特休從「天數」欄位搬成「時數」欄位（totalDays / usedDays -> totalHours / usedHours）。
// 2. migrateLeaveFormsToHours：請假表單補上「時數」欄位，並把舊的「天數」欄位停用（不刪除，舊假單的答案還在）。
// 放在獨立的模組：startupMigrations.test.js 以原始碼比對 index.js 對 approvalTemplateController 的匯入寫法。
import Employee from '../models/Employee.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
// 用命名空間匯入：別的測試把 leaveFieldService 換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as leaveFieldService from './leaveFieldService.js'
import { interpretLegacyAnnualLeave } from '../utils/annualLeaveHours.js'
import { isLeaveFormTemplate } from '../utils/formSemantics.js'
import { isLeaveDaysLabel, isLeaveEndLabel, isLeaveHoursLabel } from '../utils/leaveFieldLabels.js'
import { LEAVE_DAY_EQUIVALENT_HOURS, roundHours } from '../utils/leaveHours.js'

const BATCH_SIZE = 500
const LEGACY_CANDIDATE_FILTER = { annualLeave: { $type: 'object' }, 'annualLeave.totalHours': { $exists: false } }

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

// 一位員工的搬移結果：{ set, fromDays, alreadyHours, repaired }
async function buildHoursUpdate(employee) {
  const legacy = employee?.annualLeave || {}
  const interpreted = interpretLegacyAnnualLeave(legacy.totalDays, legacy.usedDays)
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

/**
 * 員工特休從天數搬成時數（冪等）：
 * - 找出有 annualLeave 但還沒有 totalHours 的員工；天數欄位的數字大於 40（不可能是天數）原樣視為小時，其餘乘 8。
 * - 寫入條件再確認一次沒有 totalHours，所以重複或同時執行都不會重複搬；舊的 totalDays / usedDays 保持原狀（供稽核與回復）。
 * - 不更新 updatedAt（不是人工修改）。
 * @returns {Promise<{ migrated: number, fromDays: number, alreadyHours: number, repaired: number }>}
 */
export async function migrateAnnualLeaveToHours() {
  const candidates = await Employee.find(LEGACY_CANDIDATE_FILTER)
    .select('+annualLeave.appliedApprovalRequestIds')
    .lean()
  const result = { migrated: 0, fromDays: 0, alreadyHours: 0, repaired: 0 }
  if (!candidates?.length) return result

  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE)
    const operations = []
    const meta = []
    for (const employee of batch) {
      const update = await buildHoursUpdate(employee)
      operations.push({
        updateOne: {
          filter: { _id: employee._id, 'annualLeave.totalHours': { $exists: false } },
          update: { $set: update.set },
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
  return result
}

/**
 * 單一員工的搬移（扣減、返還、設定特休時發現還是舊格式才用）。回傳這次有沒有真的搬。
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
  ensureAnnualLeaveHours,
  migrateLeaveFormsToHours,
}
