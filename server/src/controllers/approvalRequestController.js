import ApprovalWorkflow from '../models/approval_workflow.js'
import ApprovalRequest from '../models/approval_request.js'
import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import Employee from '../models/Employee.js'

const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'

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

  // group: 你可以自己定義群組機制，這裡先不實作
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
    for (const s of wf.steps) {
      const empIds = await resolveApprovers(s, applicantEmp)
      reqSteps.push({
        step_order: s.step_order,
        approvers: buildDecisionList(empIds),
        all_must_approve: !!s.all_must_approve,
        is_required: !!s.is_required,
        can_return: !!s.can_return,
      })
    }
    // 第一關時間標記
    if (reqSteps[0]) reqSteps[0].started_at = new Date()

    const doc = await ApprovalRequest.create({
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

    // 通知第一關審核人
    const firstApproverEmpIds = (reqSteps[0]?.approvers || []).map(a => a.approver)
    await notifyUsers(firstApproverEmpIds, `有新的【${form.name}】待簽`)

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

/* 進到下一關 or 結案 */
async function tryAdvance(doc) {
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
    await notifyUsers(nextApprovers, '有新的簽核待處理')
  } else {
    // 全部完成
    doc.status = 'approved'
    doc.logs.push({ action: 'finish', message: '全部完成' })
    await doc.save()
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
