import { Router } from 'express';
import {
  getHolidayLedger,
  exportHolidayLedger,
  saveHolidayLedgerResolution,
  deleteHolidayLedgerResolution,
  listHolidayLedgerCompensations,
  syncHolidayLedgerCompensations,
  createHolidayLedgerCompensation,
  assignHolidayLedgerCompensation,
  unassignHolidayLedgerCompensation,
  listHolidayLedgerSwaps,
  createHolidayLedgerSwap,
  revokeHolidayLedgerSwap,
} from '../controllers/holidayLedgerController.js';
import { authorizeRoles } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/scheduleAccess.js';

const router = Router();

// 查詢開放給員工（只看得到自己）、主管（自己與直屬部屬）、排班人員（再加上被指定小單位的員工）、管理員；
// 匯出、登記與刪除處理方式、重新計算、個人調移只有有排班權限的人（管理員、主管、排班人員）；
// HR 指定調休日、手動補登調休只有管理員，不論這個 router 掛在哪個路徑下。
const managersOnly = requireScheduleAccess();
const adminOnly = authorizeRoles('admin');

router.get('/', getHolidayLedger);
router.get('/export', managersOnly, exportHolidayLedger);
router.post('/resolutions', managersOnly, saveHolidayLedgerResolution);
router.delete('/resolutions/:id', managersOnly, deleteHolidayLedgerResolution);

// 國定假日的調休（國定假日落在休息日／例假，存入調休存摺）：年度清單、重新計算、手動補登、HR 指定調休日與取消
router.get('/compensations', listHolidayLedgerCompensations);
router.post('/compensations/sync', managersOnly, syncHolidayLedgerCompensations);
router.post('/compensations', adminOnly, createHolidayLedgerCompensation);
router.post('/compensations/:id/assign', adminOnly, assignHolidayLedgerCompensation);
router.post('/compensations/:id/unassign', adminOnly, unassignHolidayLedgerCompensation);

// 個人調移（須有員工本人的同意紀錄）
router.get('/swaps', listHolidayLedgerSwaps);
router.post('/swaps', managersOnly, createHolidayLedgerSwap);
router.post('/swaps/:id/revoke', managersOnly, revokeHolidayLedgerSwap);

export default router;
