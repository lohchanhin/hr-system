import { Router } from 'express'
import {
  listFormTemplates, createFormTemplate, getFormTemplate, updateFormTemplate, deleteFormTemplate,
  addField, updateField, deleteField, listFields,
  getWorkflow, setWorkflow,
} from '../controllers/approvalTemplateController.js'

import {
  createApprovalRequest, getApprovalRequest, myApprovalRequests, inboxApprovals, actOnApproval,
} from '../controllers/approvalRequestController.js'

const router = Router()

// Form Template
router.get('/forms', listFormTemplates)
router.post('/forms', createFormTemplate)
router.get('/forms/:id', getFormTemplate)
router.put('/forms/:id', updateFormTemplate)
router.delete('/forms/:id', deleteFormTemplate)

// Fields
router.get('/forms/:formId/fields', listFields)
router.post('/forms/:formId/fields', addField)
router.put('/forms/:formId/fields/:fieldId', updateField)
router.delete('/forms/:formId/fields/:fieldId', deleteField)

// Workflow
router.get('/forms/:formId/workflow', getWorkflow)
router.put('/forms/:formId/workflow', setWorkflow)

// Requests
router.post('/approvals', createApprovalRequest)           // 建立送審單
router.get('/approvals/:id', getApprovalRequest)           // 單筆
router.get('/approvals', myApprovalRequests)               // 申請者列表 ?employee_id=
router.get('/inbox', inboxApprovals)                       // 審核者待辦 ?employee_id=
router.post('/approvals/:id/act', actOnApproval)           // { decision:'approve'|'reject'|'return', comment?, employee_id? }

export default router
