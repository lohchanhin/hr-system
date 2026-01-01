import mongoose from 'mongoose'
import ApprovalWorkflow from '../models/approval_workflow.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import Employee from '../models/Employee.js'
import SubDepartment from '../models/SubDepartment.js'
import { getLeaveFieldIds } from '../services/leaveFieldService.js'
import { deductAnnualLeave } from '../services/annualLeaveService.js'

const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const ANNUAL_LEAVE_TYPES = ['特休', '特休假'] // 特休假別類型常數

/* 依流程步驟解析「此關簽核人」 */
export async function resolveApprovers(step, applicantEmp) {
  const type = step.approver_type
  const val = step.approver_value
  const scope = step.scope_type || 'none'

  // 篩選器：依 scope 過濾
  const scopeFilter = {}
  if (scope === 'dept' && applicantEmp?.department) scopeFilter.department = applicantEmp.department
  if (scope === 'org' && applicantEmp?.organization) scopeFilter.organization = applicantEmp.organization

  if (type === 'manager') {
    const candidates = Array.isArray(val) ? val : [val]
    const selected = candidates.find((item) => item != null && item !== '')
    let targetId = ''
    if (selected != null && selected !== '') {
      if (typeof selected === 'object') {
        targetId = String(selected._id || selected.id || selected.value || '')
      } else {
        targetId = String(selected)
      }
    }

    if (!targetId || targetId === APPLICANT_SUPERVISOR_VALUE) {
      if (!applicantEmp?.supervisor) return []
      return [applicantEmp.supervisor]
    }

    const supervisor = await Employee.findById(targetId, { _id: 1, role: 1 })
    if (!supervisor || supervisor.role !== 'supervisor') return []
    return [supervisor._id]
  }

  if (type === 'tag') {
    // 以 Employee.signTags 為基礎
    const tagName = String(val || '')
    if (!tagName) return []
    const list = await Employee.find({ signTags: tagName, ...scopeFilter }, { _id: 1 })
    return list.map(x => x._id)
  }

  if (type === 'user') {
    // val 可為單一或陣列（Employee _id）
    const arr = Array.isArray(val) ? val : [val]
    return arr.filter(Boolean)
  }

  if (type === 'role') {
    const role = String(val || '')
    if (!role) return []
    const list = await Employee.find({ role, ...scopeFilter }, { _id: 1 })
    return list.map(x => x._id)
  }

  if (type === 'department') {
    const dept = val || applicantEmp?.department
    if (!dept) return []
    const list = await Employee.find({ department: dept }, { _id: 1 })
    return list.map(x => x._id)
  }

  if (type === 'org') {
    const org = val || applicantEmp?.organization
    if (!org) return []
    const list = await Employee.find({ organization: org }, { _id: 1 })
    return list.map(x => x._id)
  }

  if (type === 'group') {
    const arr = Array.isArray(val) ? val : [val]
    const subDeptIds = arr
      .map((item) => {
        if (typeof item === 'object' && item) {
          return item._id || item.id || item.value || ''
        }
        return item
      })
      .map((id) => (typeof id === 'string' ? id : String(id || '')))
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))

    if (!subDeptIds.length) return []

    const validSubDepts = await SubDepartment.find({ _id: { $in: subDeptIds } }, { _id: 1 })
    if (!validSubDepts.length) return []

    const validIds = validSubDepts.map((sub) => sub._id.toString())
    const list = await Employee.find({ subDepartment: { $in: validIds }, ...scopeFilter }, { _id: 1 })
    return list.map((emp) => emp._id)
  }

  // 其他尚未支援的簽核類型
  return []
}

function buildDecisionList(employeeIds) {
  return employeeIds.map(id => ({ approver: id, decision: 'pending' }))
}

async function notifyUsers(userIds, message) {
  // TODO: 串你的通知系統（站內信/Email/Line 等）
  // console.log('notify', userIds, message)
}

/* 建立送審單 */
export async function createApprovalRequest(req, res) {
  try {
    const { form_id, form_data, applicant_employee_id } = req.body
    if (!form_id) return res.status(400).json({ error: 'form_id required' })
    const form = await FormTemplate.findById(form_id)
    if (!form) return res.status(400).json({ error: 'form not found' })
    if (!form.is_active) return res.status(400).json({ error: 'form not available' })

    const wf = await ApprovalWorkflow.findOne({ form: form._id })
    if (!wf || !wf.steps?.length) return res.status(400).json({ error: 'workflow not configured' })

    const applicantEmp = applicant_employee_id
      ? await Employee.findById(applicant_employee_id)
      : await Employee.findById(req.user?.id)

    // 依每關解析審核人
    const reqSteps = []
    let previousSignature = null
    for (const s of wf.steps) {
      const empIds = await resolveApprovers(s, applicantEmp)
      const orderedApproverIds = []
      const seen = new Set()
      for (const rawId of empIds || []) {
        const id = rawId != null ? String(rawId) : ''
        if (!id || seen.has(id)) continue
        seen.add(id)
        orderedApproverIds.push(id)
      }

      const sortedApproverIds = [...orderedApproverIds].sort()
      const normalizedConfig = {
        approvers: sortedApproverIds,
        all_must_approve: !!s.all_must_approve,
        is_required: !!s.is_required,
        can_return: !!s.can_return,
      }
      const signature = JSON.stringify(normalizedConfig)
      if (signature === previousSignature) {
        previousSignature = signature
        continue
      }
      previousSignature = signature

      reqSteps.push({
        step_order: reqSteps.length + 1,
        approvers: buildDecisionList(orderedApproverIds),
        all_must_approve: normalizedConfig.all_must_approve,
        is_required: normalizedConfig.is_required,
        can_return: normalizedConfig.can_return,
      })
    }

    reqSteps.forEach((step, index) => {
      step.step_order = index + 1
    })
    // 第一關時間標記
    if (reqSteps[0]) reqSteps[0].started_at = new Date()

    let doc = await ApprovalRequest.create({
      form: form._id,
      workflow: wf._id,
      form_data,
      applicant_employee: applicantEmp?._id || req.user?.id,
      applicant_org: applicantEmp?.organization,
      applicant_department: applicantEmp?.department,
      status: 'pending',
      current_step_index: 0,
      steps: reqSteps,
      logs: [{ action: 'create', by_employee: applicantEmp?._id || req.user?.id, message: '建立送審單' }],
    })

    const message = `有新的【${form.name}】待簽`

    let advanced = false
    let guard = 0
    while (doc.status === 'pending' && guard < doc.steps.length) {
      const currentStep = doc.steps[doc.current_step_index]
      if (!currentStep || currentStep.approvers.length > 0) break
      advanced = true
      await tryAdvance(doc, { notifyMessage: message })
      const refreshed = await ApprovalRequest.findById(doc._id)
      if (!refreshed) break
      doc = refreshed
      guard += 1
    }

    if (!advanced && doc.status === 'pending') {
      const currentStep = doc.steps[doc.current_step_index]
      const approverIds = (currentStep?.approvers || [])
        .filter(a => a.decision === 'pending')
        .map(a => a.approver)
      await notifyUsers(approverIds, message)
    }

    res.status(201).json(doc)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* 取得送審單 */
export async function getApprovalRequest(req, res) {
  try {
    const doc = await ApprovalRequest.findById(req.params.id)
      .populate('form', 'name category')
      .populate('applicant_employee', 'name employeeId department organization')
      .populate('steps.approvers.approver', 'name employeeId')
    if (!doc) return res.status(404).json({ error: 'not found' })
    const fields = await FormField.find({ form: doc.form._id }).sort({ order: 1 })
    const result = doc.toObject()
    result.form.fields = fields
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* 申請者的清單 */
export async function myApprovalRequests(req, res) {
  try {
    const empId = req.query.employee_id || req.user?.id
    const list = await ApprovalRequest.find({ applicant_employee: empId }).sort({ createdAt: -1 })
    res.json(list)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* 審核者的待辦匣 */
export async function inboxApprovals(req, res) {
  try {
    const empId = req.query.employee_id || req.user?.id
    // 找出目前關卡包含我，且我的 decision 是 pending 的
    // 使用 $elemMatch 確保 approver 與 decision 位於同一子文件
    const list = await ApprovalRequest.find({
      status: 'pending',
      steps: {
        $elemMatch: {
          approvers: { $elemMatch: { approver: empId, decision: 'pending' } },
        },
      },
    })
      .sort({ createdAt: -1 })
      .populate('form', 'name category')
      .populate('applicant_employee', 'name employeeId department organization')
    // 仍以程式邏輯判斷是否為當前關卡：
    const mine = list.filter(doc => {
      const step = doc.steps?.[doc.current_step_index]
      if (!step) return false
      return step.approvers.some(a => String(a.approver) === String(empId) && a.decision === 'pending')
    })
    res.json(mine)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* 已簽核歷史紀錄（主管視角） */
export async function historyApprovals(req, res) {
  try {
    const empId = req.query.employee_id || req.user?.id
    if (!empId) return res.status(400).json({ error: 'employee id required' })

    const docs = await ApprovalRequest.find({
      steps: {
        $elemMatch: {
          approvers: {
            $elemMatch: { approver: empId, decision: { $ne: 'pending' } },
          },
        },
      },
    })
      .sort({ updatedAt: -1 })
      .populate('form', 'name category')
      .populate('applicant_employee', 'name employeeId department organization')

    const results = docs.map((doc) => {
      const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc
      const actions = []
      ;(obj.steps || []).forEach((step, index) => {
        const stepOrder = step.step_order ?? (index + 1)
        ;(step.approvers || []).forEach((approver) => {
          const approverId = (() => {
            if (!approver) return ''
            if (typeof approver.approver === 'object' && approver.approver) {
              return approver.approver._id || approver.approver.id || String(approver.approver)
            }
            return approver.approver
          })()
          if (String(approverId) === String(empId) && approver.decision !== 'pending') {
            actions.push({
              step_order: stepOrder,
              decision: approver.decision,
              decided_at: approver.decided_at,
              comment: approver.comment,
            })
          }
        })
      })

      return {
        _id: obj._id,
        status: obj.status,
        form: obj.form,
        applicant_employee: obj.applicant_employee,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
        my_approvals: actions,
      }
    }).filter(item => item.my_approvals.length)

    res.json(results)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* 處理特休扣減（當請假審核通過時） */
async function handleAnnualLeaveDeduction(doc) {
  try {
    // 取得表單資訊
    const form = await FormTemplate.findById(doc.form).lean()
    if (!form || form.name !== '請假') {
      return // 不是請假表單，不處理
    }

    // 取得假別欄位設定
    const leaveFields = await getLeaveFieldIds()
    if (!leaveFields.typeId) {
      console.warn('[AnnualLeave] Leave type field not found')
      return
    }

    // 檢查假別是否為特休
    const leaveTypeValue = doc.form_data?.[leaveFields.typeId]
    let leaveTypeName = null
    
    // 處理不同格式的假別資料
    if (typeof leaveTypeValue === 'string') {
      leaveTypeName = leaveTypeValue
    } else if (leaveTypeValue?.label) {
      leaveTypeName = leaveTypeValue.label
    } else if (leaveTypeValue?.value) {
      // 從 typeOptions 中查找對應的 label
      const option = leaveFields.typeOptions?.find(opt => opt.value === leaveTypeValue.value)
      leaveTypeName = option?.label || leaveTypeValue.value
    }

    // 檢查是否為特休
    if (!leaveTypeName || !ANNUAL_LEAVE_TYPES.includes(leaveTypeName)) {
      return // 不是特休，不處理
    }

    // 計算請假天數
    const startDate = doc.form_data?.[leaveFields.startId]
    const endDate = doc.form_data?.[leaveFields.endId]
    let days = doc.form_data?.days || 1 // 預設 1 天

    // 如果有開始和結束日期，計算天數
    if (startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      
      // 確保結束日期在開始日期之後
      if (end >= start) {
        const diffTime = end - start
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1 // 包含起始日
        days = diffDays
      }
    }

    // 扣減特休
    if (doc.applicant_employee && days > 0) {
      await deductAnnualLeave(doc.applicant_employee, days, doc._id.toString())
      console.log(`[AnnualLeave] Successfully deducted ${days} days for employee ${doc.applicant_employee}`)
    }
  } catch (error) {
    // 記錄錯誤但不影響審核流程
    console.error('[AnnualLeave] Failed to deduct annual leave:', error.message)
    doc.logs.push({
      action: 'annual_leave_error',
      message: `特休扣減失敗: ${error.message}`
    })
    await doc.save()
  }
}

/* 進到下一關 or 結案 */
async function tryAdvance(doc, options = {}) {
  const { notifyMessage } = options
  const idx = doc.current_step_index
  const step = doc.steps[idx]
  if (!step) return doc

  const allApproved = step.approvers.length === 0
    ? true
    : step.approvers.every(a => a.decision === 'approved')

  if (!allApproved) return doc

  // 本關完成
  doc.steps[idx].finished_at = new Date()

  if (idx + 1 < doc.steps.length) {
    // 下一關
    doc.current_step_index = idx + 1
    doc.steps[idx + 1].started_at = new Date()
    doc.logs.push({ action: 'move_next', message: `進入第 ${idx + 2} 關` })
    await doc.save()
    // 通知下一關
    const nextApprovers = doc.steps[idx + 1].approvers.map(a => a.approver)
    await notifyUsers(nextApprovers, notifyMessage || '有新的簽核待處理')
  } else {
    // 全部完成
    doc.status = 'approved'
    doc.logs.push({ action: 'finish', message: '全部完成' })
    await doc.save()
    
    // 處理特休扣減
    await handleAnnualLeaveDeduction(doc)
  }
  return doc
}

/* Approve/Reject/Return */
export async function actOnApproval(req, res) {
  try {
    const { decision, comment } = req.body                  // 'approve' | 'reject' | 'return'
    if (!['approve','reject','return'].includes(decision)) {
      return res.status(400).json({ error: 'invalid decision' })
    }
    const doc = await ApprovalRequest.findById(req.params.id)
    if (!doc) return res.status(404).json({ error: 'not found' })
    if (doc.status !== 'pending') return res.status(400).json({ error: 'not pending' })
    const empId = req.body.employee_id || req.user?.id
    const idx = doc.current_step_index
    const step = doc.steps[idx]
    if (!step) return res.status(400).json({ error: 'invalid step' })

    const me = step.approvers.find(a => String(a.approver) === String(empId))
    if (!me || me.decision !== 'pending') return res.status(403).json({ error: 'not step approver or already acted' })

    if (decision === 'return') {
      if (!step.can_return) return res.status(400).json({ error: 'return not allowed' })
      // 回上一關（或退回申請者）
      if (idx > 0) {
        // 清空上一關的已決定狀態 → 重新簽
        doc.steps[idx - 1].approvers = doc.steps[idx - 1].approvers.map(a => ({ ...a, decision: 'pending', comment: undefined, decided_at: undefined }))
        doc.current_step_index = idx - 1
        doc.steps[idx - 1].started_at = new Date()
        doc.logs.push({ action: 'return', message: `退回到第 ${idx} 關`, by_employee: empId })
        await doc.save()
      } else {
        // 退回申請者：整筆改成 returned
        doc.status = 'returned'
        doc.logs.push({ action: 'return', message: '退回申請者', by_employee: empId })
        await doc.save()
      }
      return res.json(doc)
    }

    if (decision === 'reject') {
      me.decision = 'rejected'
      me.comment = comment
      me.decided_at = new Date()
      doc.status = 'rejected'
      doc.logs.push({ action: 'reject', message: comment, by_employee: empId })
      await doc.save()
      return res.json(doc)
    }

    // approve
    me.decision = 'approved'
    me.comment = comment
    me.decided_at = new Date()
    doc.logs.push({ action: 'approve', message: comment, by_employee: empId })
    await doc.save()

    // 若此關 all_must_approve，需等全部核可；否則任一人核可即可前進
    if (!step.all_must_approve) {
      // 只要有人 approve 就視為本關完成，其餘 pending 標記為「跳過」
      step.approvers = step.approvers.map(a => a.decision === 'pending' ? { ...a, decision: 'approved' } : a)
      await doc.save()
    } else {
      // all_must_approve = true，就等全部 approved
    }

    await tryAdvance(doc)
    const fresh = await ApprovalRequest.findById(doc._id)
    res.json(fresh)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}
