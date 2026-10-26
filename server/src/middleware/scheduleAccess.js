import { getScheduleAccessSummaryForRequest } from '../services/scheduleAccessService.js';

/**
 * 排班功能的權限檢查（取代原本只看角色的 authorizeRoles('supervisor', 'admin')）：
 * 管理員、主管（排班權限模式允許時）與被指定為排班人員的員工（任何角色）都能使用，範圍由各 API 再檢查。
 * - allowRoles：這些角色不查排班權限直接放行（維持原本就開放給該角色的 API，例如主管讀小單位清單）
 * - excludeRoles：這些角色一律不放行（例如主管統計原本就不開放給管理員）
 */
export function requireScheduleAccess({ allowRoles = [], excludeRoles = [] } = {}) {
  return async (req, res, next) => {
    const role = req.user?.role;
    if (!req.user || excludeRoles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    if (allowRoles.includes(role)) return next();
    try {
      const access = await getScheduleAccessSummaryForRequest(req);
      if (access?.canSchedule) return next();
      return res.status(403).json({ error: 'Forbidden' });
    } catch (err) {
      console.error('Schedule access check failed', { error: err?.name ?? 'Error' });
      return res.status(503).json({ error: 'Schedule access check unavailable' });
    }
  };
}
