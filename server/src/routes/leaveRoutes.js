import { Router } from 'express';
import { listLeaves, createLeave } from '../controllers/leaveController.js';

const router = Router();

router.get('/', listLeaves);
router.post('/', createLeave);

export default router;
