import { Router } from 'express';
import {
  getHolidayLedger,
  exportHolidayLedger,
  saveHolidayLedgerResolution,
  deleteHolidayLedgerResolution,
} from '../controllers/holidayLedgerController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

// 查詢開放給員工（只看得到自己）、主管（自己與直屬部屬）、管理員；
// 匯出、登記與刪除處理方式只有主管與管理員，不論這個 router 掛在哪個路徑下。
const managersOnly = authorizeRoles('supervisor', 'admin');

router.get('/', getHolidayLedger);
router.get('/export', managersOnly, exportHolidayLedger);
router.post('/resolutions', managersOnly, saveHolidayLedgerResolution);
router.delete('/resolutions/:id', managersOnly, deleteHolidayLedgerResolution);

export default router;
