import { Router } from 'express'
import {
  listFormTemplates, createFormTemplate, getFormTemplate, updateFormTemplate, deleteFormTemplate,
  addField, updateField, deleteField, listFields,
  getWorkflow, setWorkflow, getSignRoles, getSignLevels, ensureLeaveForm,
  restoreDefaultTemplates,
} from '../controllers/approvalTemplateController.js'

import {
  createApprovalRequest, getApprovalRequest, myApprovalRequests, inboxApprovals, actOnApproval, historyApprovals,
  uploadApprovalAttachments, downloadApprovalAttachment, cancelApprovalRequest, resubmitApprovalRequest,
} from '../controllers/approvalRequestController.js'

import { getLeaveBalances, getLeaveHoursHint } from '../controllers/leaveBalanceController.js'
import { getTopLevelApprovers, updateTopLevelApprovers } from '../controllers/approvalPolicyController.js'

import { authorizeRoles } from '../middleware/auth.js'
import { uploadApprovalAttachmentFiles } from '../middleware/approvalAttachmentUpload.js'

const router = Router()

// Form Template
router.get('/forms', authorizeRoles('employee', 'supervisor', 'admin'), listFormTemplates)
router.post('/forms', authorizeRoles('admin'), createFormTemplate)
router.get('/forms/:id', authorizeRoles('employee', 'supervisor', 'admin'), getFormTemplate)
router.put('/forms/:id', authorizeRoles('admin'), updateFormTemplate)
router.delete('/forms/:id', authorizeRoles('admin'), deleteFormTemplate)

// Ensure leave form exists (auto-generate if missing)
router.post('/ensure-leave-form', authorizeRoles('admin'), ensureLeaveForm)

// Restore default templates
router.post('/restore-defaults', authorizeRoles('admin'), restoreDefaultTemplates)

// Fields
router.get('/forms/:formId/fields', authorizeRoles('employee', 'supervisor', 'admin'), listFields)
router.post('/forms/:formId/fields', authorizeRoles('admin'), addField)
router.put('/forms/:formId/fields/:fieldId', authorizeRoles('admin'), updateField)
router.delete('/forms/:formId/fields/:fieldId', authorizeRoles('admin'), deleteField)

// Workflow
router.get('/forms/:formId/workflow', authorizeRoles('employee', 'supervisor', 'admin'), getWorkflow)
router.put('/forms/:formId/workflow', authorizeRoles('admin'), setWorkflow)
router.get('/sign-roles', authorizeRoles('employee', 'supervisor', 'admin'), getSignRoles)
router.get('/sign-levels', authorizeRoles('employee', 'supervisor', 'admin'), getSignLevels)

// 無上級主管時的最高層簽核人（全公司共用，只有管理員）；要排在 GET /:id 之前
router.get('/top-level-approvers', authorizeRoles('admin'), getTopLevelApprovers)
router.put('/top-level-approvers', authorizeRoles('admin'), updateTopLevelApprovers)

// Requests
router.post(
  '/attachments',
  authorizeRoles('employee', 'supervisor', 'admin'),
  uploadApprovalAttachmentFiles,
  uploadApprovalAttachments,
)
router.post('/', authorizeRoles('employee', 'supervisor', 'admin'), createApprovalRequest)
router.get('/inbox', authorizeRoles('employee', 'supervisor', 'admin'), inboxApprovals)
router.get('/history', authorizeRoles('employee', 'supervisor', 'admin'), historyApprovals)
// 假別餘額（小時）：一定要排在 GET /:id 之前，否則 "leave-balances" 會被當成簽核單編號而回 400
router.get('/leave-balances', authorizeRoles('employee', 'supervisor', 'admin'), getLeaveBalances)
// 填請假單時依班表算出時數的上限與建議值（同樣要排在 GET /:id 之前）
router.get('/leave-hours-hint', authorizeRoles('employee', 'supervisor', 'admin'), getLeaveHoursHint)
router.get('/:id/attachments/:filename', authorizeRoles('employee', 'supervisor', 'admin'), downloadApprovalAttachment)
router.post('/:id/cancel', authorizeRoles('employee', 'supervisor', 'admin'), cancelApprovalRequest)
router.post('/:id/resubmit', authorizeRoles('employee', 'supervisor', 'admin'), resubmitApprovalRequest)
router.get('/:id', authorizeRoles('employee', 'supervisor', 'admin'), getApprovalRequest)
router.get('/', authorizeRoles('employee', 'supervisor', 'admin'), myApprovalRequests)
router.post('/:id/act', authorizeRoles('employee', 'supervisor', 'admin'), actOnApproval)

export default router
