import { Router } from 'express';
import { getShifts, createShift, updateShift, deleteShift } from '../controllers/shiftController.js';

const router = Router();

router.get('/', getShifts);
router.post('/', createShift);
router.put('/:id', updateShift);
router.delete('/:id', deleteShift);

export default router;
