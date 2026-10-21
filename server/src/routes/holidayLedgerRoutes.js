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

const router = Router();

// 查詢開放給員工（只看得到自己）、主管（自己與直屬部屬）、管理員；
// 匯出、登記與刪除處理方式、排定補假、個人調移只有主管與管理員，不論這個 router 掛在哪個路徑下。
const managersOnly = authorizeRoles('supervisor', 'admin');

router.get('/', getHolidayLedger);
router.get('/export', managersOnly, exportHolidayLedger);
router.post('/resolutions', managersOnly, saveHolidayLedgerResolution);
router.delete('/resolutions/:id', managersOnly, deleteHolidayLedgerResolution);

// 補假義務（國定假日落在休息日／例假）：年度清單、重新計算、手動新增、排定與取消
router.get('/compensations', listHolidayLedgerCompensations);
router.post('/compensations/sync', managersOnly, syncHolidayLedgerCompensations);
router.post('/compensations', managersOnly, createHolidayLedgerCompensation);
router.post('/compensations/:id/assign', managersOnly, assignHolidayLedgerCompensation);
router.post('/compensations/:id/unassign', managersOnly, unassignHolidayLedgerCompensation);

// 個人調移（須有員工本人的同意紀錄）
router.get('/swaps', listHolidayLedgerSwaps);
router.post('/swaps', managersOnly, createHolidayLedgerSwap);
router.post('/swaps/:id/revoke', managersOnly, revokeHolidayLedgerSwap);

export default router;
