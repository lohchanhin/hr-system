import mongoose from 'mongoose'
import ApprovalRequest from '../models/approval_request.js'
import { buildLeaveBalances, currentTaipeiYear } from '../services/leaveBalanceService.js'
import { getLeavePolicy } from '../services/leavePolicyService.js'
import { buildLeaveHoursHint, loadScheduledShiftHours } from '../services/leaveShiftHours.js'
import { parseLeaveInterval } from '../utils/leaveDuration.js'
import { getAllowedScheduleEmployeeIds } from './schedule/scheduleShared.js'

const NOT_FOUND_MESSAGE = '找不到這位員工的資料'
const MIN_YEAR = 2000
const MAX_YEAR = 2100

function normalizeId(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return normalizeId(value._id)
  return typeof value.toString === 'function' ? value.toString() : String(value)
}

/*
 * 誰可以看某位員工的假別餘額（病假時數屬於敏感資料，範圍跟「簽核單明細」一致，不多給）：
 * 本人、管理員、申請人在自己排班範圍內的主管（直屬部屬），以及曾被排進這位員工任何一張簽核單的簽核人（例如人資）。
 */
async function canReadBalances(req, actorId, targetId) {
  if (actorId === targetId) return true
  if (req.user?.role === 'admin') return true
  const allowedIds = await getAllowedScheduleEmployeeIds(req)
  if (allowedIds === null || allowedIds.includes(targetId)) return true
  const asApprover = await ApprovalRequest.exists({
    applicant_employee: targetId,
    'steps.approvers.approver': actorId,
  })
  return Boolean(asApprover)
}

/** GET /api/approvals/leave-balances?employeeId=&year= - 員工各假別的額度、已使用、簽核中、剩餘（小時） */
export async function getLeaveBalances(req, res) {
  try {
    const actorId = normalizeId(req.user?.id)
    if (!actorId) return res.status(401).json({ error: '登入狀態無效，請重新登入' })

    const rawEmployeeId = req.query?.employeeId
    if (rawEmployeeId !== undefined && typeof rawEmployeeId !== 'string') {
      return res.status(400).json({ error: '員工編號格式不正確' })
    }
    const targetId = rawEmployeeId ? rawEmployeeId.trim() : actorId
    if (!mongoose.isValidObjectId(targetId) || !/^[a-f0-9]{24}$/i.test(targetId)) {
      return res.status(400).json({ error: '員工編號格式不正確' })
    }

    let year = currentTaipeiYear()
    if (req.query?.year !== undefined && req.query.year !== '') {
      const parsed = Number(req.query.year)
      if (typeof req.query.year !== 'string' || !Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
        return res.status(400).json({ error: `年度必須是 ${MIN_YEAR} 到 ${MAX_YEAR} 之間的整數` })
      }
      year = parsed
    }

    if (!(await canReadBalances(req, actorId, targetId))) {
      return res.status(404).json({ error: NOT_FOUND_MESSAGE })
    }
    const balances = await buildLeaveBalances({ employeeId: targetId, year })
    if (!balances) return res.status(404).json({ error: NOT_FOUND_MESSAGE })
    return res.json(balances)
  } catch (error) {
    // 只記錄錯誤名稱：餘額含病假等敏感資料，不寫進 log
    console.error(`[LeaveBalance] request failed: ${error?.name || 'Error'}`)
    return res.status(500).json({ error: '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員' })
  }
}

const MAX_HINT_VALUE_LENGTH = 64

/**
 * GET /api/approvals/leave-hours-hint?start=&end=&startType=&endType= - 登入者請這段時間，時數的上限與建議值。
 * 依班表算：排工作班的日子算班別的時數（12 小時班就是 12），排休息日、例假、國定假日、請假的日子算 0，沒排班的日子算每日上限。
 * 只看登入者自己的班表。這只是填單時的預設值；伺服器在送出時會再檢查一次。
 */
export async function getLeaveHoursHint(req, res) {
  try {
    const actorId = normalizeId(req.user?.id)
    if (!actorId) return res.status(401).json({ error: '登入狀態無效，請重新登入' })
    const { start, end, startType, endType } = req.query || {}
    if (typeof start !== 'string' || typeof end !== 'string' || !start.trim() || !end.trim()
      || start.length > MAX_HINT_VALUE_LENGTH || end.length > MAX_HINT_VALUE_LENGTH) {
      return res.status(400).json({ error: '請提供請假的開始與結束時間' })
    }
    const interval = parseLeaveInterval(start.trim(), end.trim(), { startType, endType })
    if (!interval) return res.status(400).json({ error: '請假的開始或結束時間無法判讀' })

    const policy = await getLeavePolicy()
    let schedule = new Map()
    let scheduleChecked = true
    if (!interval.reversed) {
      try {
        schedule = await loadScheduledShiftHours(actorId, interval.startKey, interval.lastKey)
      } catch {
        // 班表查不到就退回日曆日的估算，不影響填單
        scheduleChecked = false
      }
    }
    const hint = buildLeaveHoursHint({
      interval,
      schedule,
      maxHoursPerDay: policy.maxHoursPerDay,
      minUnitHours: policy.minUnitHours,
    })
    return res.json({
      ...hint,
      reversed: Boolean(interval.reversed),
      maxHoursPerDay: policy.maxHoursPerDay,
      minUnitHours: policy.minUnitHours,
      scheduleChecked,
    })
  } catch (error) {
    console.error(`[LeaveHoursHint] request failed: ${error?.name || 'Error'}`)
    return res.status(500).json({ error: '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員' })
  }
}

export default { getLeaveBalances, getLeaveHoursHint }
