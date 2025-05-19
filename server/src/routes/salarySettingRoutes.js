import { Router } from 'express';
import {
  listSettings,
  createSetting,
  getSetting,
  updateSetting,
  deleteSetting
} from '../controllers/salarySettingController.js';

const router = Router();

router.get('/', listSettings);
router.post('/', createSetting);
router.get('/:id', getSetting);
router.put('/:id', updateSetting);
router.delete('/:id', deleteSetting);

export default router;
