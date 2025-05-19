import { Router } from 'express';
import { getMenu } from '../controllers/menuController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getMenu);

export default router;
