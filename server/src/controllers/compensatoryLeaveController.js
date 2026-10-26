// 調休存摺 API：員工看自己的存摺（餘額、每一筆額度的來源與狀態、用在哪張簽核單），
// 主管看直屬部屬的、管理員看所有人的；管理員可以手動給予、扣除、作廢（備註必填）。
// 存摺本身的規則在 services/compensatoryLeaveService.js；國定假日來源的額度由休假紀錄同步（holidayCompensationService）。
import mongoose from 'mongoose';
import {
  CompensatoryLeaveError,
  adjustCredits,
  buildCompensatoryBank,
  createManualCredit,
  voidCredit,
} from '../services/compensatoryLeaveService.js';
// 存摺備註用命名空間取用：別的測試把 compensatoryLeaveService 換成只有部分函式的替身時，這裡不會因為缺少匯出而載入失敗
import * as bankService from '../services/compensatoryLeaveService.js';
import { computeCompLeavePendingHours } from '../services/leaveBalanceService.js';
import { getLeavePolicy } from '../services/leavePolicyService.js';
import { getAllowedScheduleEmployeeIds, toEntityId } from './schedule/scheduleShared.js';

const NOT_FOUND_MESSAGE = '找不到這位員工的資料';

function respondError(res, error, label) {
  if (error instanceof CompensatoryLeaveError) {
    const extra = {};
    for (const key of ['availableHours', 'requestedHours']) if (error[key] !== undefined) extra[key] = error[key];
    return res.status(error.status).json({ error: error.message, code: error.code, ...extra });
  }
  // 只記錄錯誤名稱：存摺含員工的休假資料，不寫進 log
  console.error(`[CompLeave] ${label} failed: ${error?.name || 'Error'}`);
  return res.status(500).json({ error: '系統發生錯誤，請稍後再試；若持續發生請聯絡管理員' });
}

function parseEmployeeId(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return mongoose.isValidObjectId(text) && /^[a-f0-9]{24}$/i.test(text) ? text : '';
}

/*
 * 誰可以看某位員工的調休存摺：本人、管理員、排班範圍內的人（主管的直屬部屬、排班人員被指定小單位的員工，與排班頁同一個範圍）。
 * 其他人一律 404（與查不到相同，不洩漏員工是否存在）。
 */
async function canReadBank(req, actorId, targetId) {
  if (actorId === targetId) return true;
  if (req.user?.role === 'admin') return true;
  const allowedIds = await getAllowedScheduleEmployeeIds(req);
  return allowedIds === null || allowedIds.includes(targetId);
}

async function bankOf(employeeId) {
  const policy = await getLeavePolicy();
  const pendingHours = await computeCompLeavePendingHours({ employeeId, policy });
  const bank = await buildCompensatoryBank({ employeeId, pendingHours, policy });
  // 管理員在員工管理填的存摺備註（看得到存摺的人都看得到；員工唯讀）
  if (typeof bankService.getEmployeeBankNote !== 'function') return bank;
  return { ...bank, note: await bankService.getEmployeeBankNote(employeeId) };
}

/** GET /api/compensatory-leave/mine - 我的調休 */
export async function getMyCompensatoryLeave(req, res) {
  try {
    const actorId = toEntityId(req.user?.id);
    if (!actorId) return res.status(401).json({ error: '登入狀態無效，請重新登入' });
    return res.json(await bankOf(actorId));
  } catch (error) {
    return respondError(res, error, 'mine');
  }
}

/** GET /api/compensatory-leave?employeeId= - 某位員工的調休存摺（本人、主管、管理員） */
export async function getEmployeeCompensatoryLeave(req, res) {
  try {
    const actorId = toEntityId(req.user?.id);
    if (!actorId) return res.status(401).json({ error: '登入狀態無效，請重新登入' });
    const raw = req.query?.employeeId;
    if (raw !== undefined && typeof raw !== 'string') return res.status(400).json({ error: '員工編號格式不正確', code: 'INVALID_EMPLOYEE' });
    const targetId = raw ? parseEmployeeId(raw) : actorId;
    if (!targetId) return res.status(400).json({ error: '員工編號格式不正確', code: 'INVALID_EMPLOYEE' });
    if (!(await canReadBank(req, actorId, targetId))) return res.status(404).json({ error: NOT_FOUND_MESSAGE });
    return res.json(await bankOf(targetId));
  } catch (error) {
    return respondError(res, error, 'employee bank');
  }
}

/** POST /api/compensatory-leave/credits { employeeId, hours, note, earnedDate? } - 管理員手動給予調休 */
export async function createCompensatoryCredit(req, res) {
  try {
    const body = req.body || {};
    const credit = await createManualCredit({
      employeeId: body.employeeId,
      hours: body.hours,
      note: body.note,
      earnedDate: body.earnedDate,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.status(201).json(credit);
  } catch (error) {
    return respondError(res, error, 'manual credit');
  }
}

/** POST /api/compensatory-leave/adjustments { employeeId, hours, note } - 管理員扣除調休（依到期日、取得日先後） */
export async function createCompensatoryAdjustment(req, res) {
  try {
    const body = req.body || {};
    const result = await adjustCredits({
      employeeId: body.employeeId,
      hours: body.hours,
      note: body.note,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.status(201).json(result);
  } catch (error) {
    return respondError(res, error, 'adjustment');
  }
}

/** POST /api/compensatory-leave/credits/:id/void { note } - 管理員作廢還沒用過的調休 */
export async function voidCompensatoryCredit(req, res) {
  try {
    const credit = await voidCredit({
      id: String(req.params?.id ?? '').trim(),
      note: req.body?.note,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.json(credit);
  } catch (error) {
    return respondError(res, error, 'void');
  }
}

/** PUT /api/compensatory-leave/note { employeeId, note } - 管理員填寫（或清除）員工存摺的備註，員工在「我的調休」唯讀看得到 */
export async function updateCompensatoryNote(req, res) {
  try {
    if (typeof bankService.saveEmployeeBankNote !== 'function') throw new Error('bank note unavailable');
    const body = req.body || {};
    const note = await bankService.saveEmployeeBankNote({
      employeeId: body.employeeId,
      note: body.note,
      actorId: toEntityId(req.user?.id) || null,
    });
    return res.json(note);
  } catch (error) {
    return respondError(res, error, 'note');
  }
}

export default {
  getMyCompensatoryLeave,
  getEmployeeCompensatoryLeave,
  createCompensatoryCredit,
  createCompensatoryAdjustment,
  voidCompensatoryCredit,
  updateCompensatoryNote,
};
