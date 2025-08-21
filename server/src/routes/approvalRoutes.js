import { Router } from 'express'
import {
  listFormTemplates, createFormTemplate, getFormTemplate, updateFormTemplate, deleteFormTemplate,
  addField, updateField, deleteField, listFields,
  getWorkflow, setWorkflow,
} from '../controllers/approvalTemplateController.js'

import {
  createApprovalRequest, getApprovalRequest, myApprovalRequests, inboxApprovals, actOnApproval,
} from '../controllers/approvalRequestController.js'

import { authorizeRoles } from '../middleware/auth.js'

const router = Router()

// Form Template
router.get('/forms', authorizeRoles('employee', 'supervisor', 'admin'), listFormTemplates)
router.post('/forms', authorizeRoles('admin'), createFormTemplate)
router.get('/forms/:id', authorizeRoles('employee', 'supervisor', 'admin'), getFormTemplate)
router.put('/forms/:id', authorizeRoles('admin'), updateFormTemplate)
router.delete('/forms/:id', authorizeRoles('admin'), deleteFormTemplate)

// Fields
router.get('/forms/:formId/fields', authorizeRoles('employee', 'supervisor', 'admin'), listFields)
router.post('/forms/:formId/fields', authorizeRoles('admin'), addField)
router.put('/forms/:formId/fields/:fieldId', authorizeRoles('admin'), updateField)
router.delete('/forms/:formId/fields/:fieldId', authorizeRoles('admin'), deleteField)

// Workflow
router.get('/forms/:formId/workflow', authorizeRoles('employee', 'supervisor', 'admin'), getWorkflow)
router.put('/forms/:formId/workflow', authorizeRoles('admin'), setWorkflow)

// Requests
router.post('/', authorizeRoles('employee', 'supervisor', 'admin'), createApprovalRequest)
router.get('/:id', authorizeRoles('employee', 'supervisor', 'admin'), getApprovalRequest)
router.get('/', authorizeRoles('employee', 'supervisor', 'admin'), myApprovalRequests)
router.get('/inbox', authorizeRoles('employee', 'supervisor', 'admin'), inboxApprovals)
router.post('/:id/act', authorizeRoles('employee', 'supervisor', 'admin'), actOnApproval)

export default router
