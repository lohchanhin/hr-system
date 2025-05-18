import { Router } from 'express';
import {
  listInsurance,
  createInsurance,
  getInsurance,
  updateInsurance,
  deleteInsurance
} from '../controllers/insuranceController.js';

const router = Router();

router.get('/', listInsurance);
router.post('/', createInsurance);
router.get('/:id', getInsurance);
router.put('/:id', updateInsurance);
router.delete('/:id', deleteInsurance);

export default router;
