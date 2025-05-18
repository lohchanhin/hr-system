import { Router } from 'express';
import { listApprovals, approve, reject } from '../controllers/approvalController.js';

const router = Router();

router.get('/', listApprovals);
router.post('/:id/approve', approve);
router.post('/:id/reject', reject);

export default router;
