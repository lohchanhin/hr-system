import { Router } from 'express';
import {
  listLeaves,
  createLeave,
  getLeave,
  updateLeave,
  deleteLeave
} from '../controllers/leaveController.js';

const router = Router();

router.get('/', listLeaves);
router.post('/', createLeave);
router.get('/:id', getLeave);
router.put('/:id', updateLeave);
router.delete('/:id', deleteLeave);

export default router;
