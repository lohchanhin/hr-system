// 整批設定員工的「自動計算加班費」（autoOvertimeCalc）：只有管理員（/api/employees 的寫入路由只開放管理員）。
// 改了薪資設定的「新進員工預設」不會動到既有員工，既有員工只能在員工資料逐一修改或用這支 API 明確地整批修改。
import mongoose from 'mongoose';
import Employee from '../models/Employee.js';
import { ACTIVE_EMPLOYEE_FILTER, countAutoOvertimeCalc } from '../services/payrollPolicyService.js';

const MAX_EMPLOYEE_IDS = 5000;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * POST /api/employees/auto-overtime-calc
 * body：{ enabled: boolean, employeeIds?: string[], dryRun?: boolean }
 * - 沒有 employeeIds：所有不是「離職員工」的員工（留職停薪也算）；有 employeeIds：只改這些人（不論狀態）。
 * - dryRun: true 只回傳 matched（符合的人數）與 willChange（設定值會改變的人數），不寫入。
 * - 實際執行是一次 updateMany（只改設定值不同的人），回傳 changed（實際改了幾筆）。
 */
export async function bulkSetAutoOvertimeCalc(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!body) return res.status(400).json({ error: '請求內容格式不正確' });
    const unknown = Object.keys(body).filter((key) => !['enabled', 'employeeIds', 'dryRun'].includes(key));
    if (unknown.length) return res.status(400).json({ error: `不認得的欄位：${unknown.join('、')}` });
    const { enabled, employeeIds, dryRun = false } = body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled 必須是 true（開啟）或 false（關閉）' });
    if (typeof dryRun !== 'boolean') return res.status(400).json({ error: 'dryRun 必須是 true 或 false' });

    let filter = { ...ACTIVE_EMPLOYEE_FILTER };
    let requestedIds = null;
    if (employeeIds !== undefined) {
      if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ error: 'employeeIds 必須是至少一位員工的 ID 陣列；要套用到所有在職員工請不要帶這個欄位' });
      }
      if (employeeIds.length > MAX_EMPLOYEE_IDS) {
        return res.status(400).json({ error: `一次最多 ${MAX_EMPLOYEE_IDS} 位員工` });
      }
      const invalid = employeeIds.filter((id) => typeof id !== 'string' || !OBJECT_ID_PATTERN.test(id));
      if (invalid.length) return res.status(400).json({ error: `員工 ID 格式不正確（共 ${invalid.length} 筆）` });
      requestedIds = [...new Set(employeeIds.map((id) => id.toLowerCase()))];
      filter = { _id: { $in: requestedIds.map((id) => new mongoose.Types.ObjectId(id)) } };
    }
    // 會改變的人：開啟時是目前不是 true 的（含舊資料沒有這個欄位的），關閉時是目前是 true 的
    const changeFilter = { ...filter, autoOvertimeCalc: enabled ? { $ne: true } : true };

    const [matched, willChange] = await Promise.all([
      Employee.countDocuments(filter),
      Employee.countDocuments(changeFilter),
    ]);
    const result = {
      enabled,
      dryRun,
      scope: requestedIds ? 'selected' : 'active',
      matched,
      willChange,
      ...(requestedIds ? { notFound: Math.max(requestedIds.length - matched, 0) } : {}),
    };
    if (dryRun) return res.json(result);

    const update = await Employee.updateMany(changeFilter, { $set: { autoOvertimeCalc: enabled } });
    return res.json({ ...result, changed: update?.modifiedCount ?? 0, stats: await countAutoOvertimeCalc() });
  } catch (err) {
    console.error('Failed to bulk update autoOvertimeCalc', { error: err?.name ?? 'Error' });
    return res.status(500).json({ error: '整批設定自動計算加班費失敗，請稍後再試' });
  }
}

export default { bulkSetAutoOvertimeCalc };
