import { Router } from 'express';
import { createManualReply } from '../controllers/conversationController.js';

const router = Router();

router.post('/:conversationId/replies', createManualReply);

export default router;
