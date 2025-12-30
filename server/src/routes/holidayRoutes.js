import { Router } from 'express';
import {
  listHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  importRocHolidays
} from '../controllers/holidayController.js';

const router = Router();

router.post('/import/roc', importRocHolidays);
router.get('/', listHolidays);
router.post('/', createHoliday);
router.put('/:id', updateHoliday);
router.delete('/:id', deleteHoliday);

export default router;
