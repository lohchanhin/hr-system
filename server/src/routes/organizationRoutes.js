import { Router } from 'express';
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization
} from '../controllers/organizationController.js';

const router = Router();

router.get('/', listOrganizations);
router.post('/', createOrganization);
router.put('/:id', updateOrganization);
router.delete('/:id', deleteOrganization);

export default router;
