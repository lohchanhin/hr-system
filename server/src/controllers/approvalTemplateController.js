import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import ApprovalWorkflow from '../models/approval_workflow.js'

const SIGN_ROLE_OPTIONS = [
  { value: 'R001', label: '填報', description: '提出申請與初始資料填寫' },
  { value: 'R002', label: '覆核', description: '確認申請內容與佐證完整性' },
  { value: 'R003', label: '審核', description: '評估申請是否符合政策與規範' },
  { value: 'R004', label: '核定', description: '做出最終核准或駁回決策' },
  { value: 'R005', label: '知會', description: '接收流程進度並保留紀錄' },
  { value: 'R006', label: '財務覆核', description: '檢視成本預算與財務影響' },
  { value: 'R007', label: '人資覆核', description: '確保人事政策與法規符合' },
]

const SIGN_LEVEL_OPTIONS = [
  { value: 'U001', label: 'L1', description: '單位承辦或第一層主管' },
  { value: 'U002', label: 'L2', description: '部門主管或組長' },
  { value: 'U003', label: 'L3', description: '處室主管或經理' },
  { value: 'U004', label: 'L4', description: '高階主管或副執行長' },
  { value: 'U005', label: 'L5', description: '執行長 / 院長 / 董事會' },
]

/* ---------------------- FormTemplate CRUD ---------------------- */
export async function listFormTemplates(req, res) {
  try {
    const { q, category, is_active } = req.query
    const filter = {}
    if (q) filter.name = new RegExp(q, 'i')
    if (category) filter.category = category
    if (is_active !== undefined) filter.is_active = is_active === 'true'
    const list = await FormTemplate.find(filter).sort({ updatedAt: -1 })
    res.json(list)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

export async function createFormTemplate(req, res) {
  try {
    const { name, category, description, owner_org_id, is_active } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    const doc = await FormTemplate.create({
      name, category, description, owner_org_id,
      is_active: is_active !== undefined ? !!is_active : true,
      created_by: req.user?.id, // 若有 auth
    })
    // 建立預設空流程
    await ApprovalWorkflow.create({ form: doc._id, steps: [], policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' } })
    res.status(201).json(doc)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function getFormTemplate(req, res) {
  try {
    const form = await FormTemplate.findById(req.params.id)
    if (!form) return res.status(404).json({ error: 'not found' })
    const fields = await FormField.find({ form: form._id, is_active: true }).sort({ order: 1 })
    const workflow = await ApprovalWorkflow.findOne({ form: form._id })
    res.json({ form, fields, workflow })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function updateFormTemplate(req, res) {
  try {
    const { name, category, description, owner_org_id, is_active } = req.body
    const updated = await FormTemplate.findByIdAndUpdate(
      req.params.id,
      { $set: { name, category, description, owner_org_id, is_active } },
      { new: true }
    )
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function deleteFormTemplate(req, res) {
  try {
    const form = await FormTemplate.findByIdAndDelete(req.params.id)
    if (!form) return res.status(404).json({ error: 'not found' })
    await FormField.deleteMany({ form: form._id })
    await ApprovalWorkflow.deleteOne({ form: form._id })
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* ---------------------- FormField CRUD ---------------------- */
export async function addField(req, res) {
  try {
    const form = await FormTemplate.findById(req.params.formId)
    if (!form) return res.status(404).json({ error: 'form not found' })
    const { label, type_1, type_2, required, options, placeholder, order, is_active } = req.body
    if (!label || !type_1) return res.status(400).json({ error: 'label & type_1 required' })
    const doc = await FormField.create({
      form: form._id, label, type_1, type_2, required: !!required, options, placeholder, order: order ?? 0, is_active: is_active !== false
    })
    res.status(201).json(doc)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function updateField(req, res) {
  try {
    const { label, type_1, type_2, required, options, placeholder, order, is_active } = req.body
    const updated = await FormField.findByIdAndUpdate(
      req.params.fieldId,
      { $set: { label, type_1, type_2, required, options, placeholder, order, is_active } },
      { new: true }
    )
    if (!updated) return res.status(404).json({ error: 'field not found' })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function deleteField(req, res) {
  try {
    const ret = await FormField.findByIdAndDelete(req.params.fieldId)
    if (!ret) return res.status(404).json({ error: 'field not found' })
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function listFields(req, res) {
  try {
    const fields = await FormField.find({ form: req.params.formId }).sort({ order: 1 })
    res.json(fields)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

/* ---------------------- Workflow Setting ---------------------- */
export async function getWorkflow(req, res) {
  try {
    const wf = await ApprovalWorkflow.findOne({ form: req.params.formId })
    if (!wf) return res.status(404).json({ error: 'workflow not found' })
    res.json(wf)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function setWorkflow(req, res) {
  try {
    const { steps, policy } = req.body
    const setObj = { steps: Array.isArray(steps) ? steps : [] }
    if (policy !== undefined) setObj.policy = policy
    const wf = await ApprovalWorkflow.findOneAndUpdate(
      { form: req.params.formId },
      { $set: setObj },
      { new: true, upsert: true }
    )
    res.json(wf)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

export async function getSignRoles(req, res) {
  res.json(SIGN_ROLE_OPTIONS)
}

export async function getSignLevels(req, res) {
  res.json(SIGN_LEVEL_OPTIONS)
}

/* ---------------------- Ensure Leave Form ---------------------- */
export async function ensureLeaveForm(req, res) {
  try {
    // Check if leave form exists
    let form = await FormTemplate.findOne({ name: '請假' })
    
    if (!form) {
      // Auto-generate leave form if it doesn't exist
      form = await FormTemplate.create({
        name: '請假',
        category: '人事',
        description: '用於申請各類假別（事假、病假、特休等），此表單會自動連接薪資系統計算扣薪或假勤。支援小時級別的精確請假時間。',
        is_active: true,
        created_by: req.user?.id,
      })

      // Create fields for leave form
      const fields = [
        { label: '假別', type_1: 'text', required: true, order: 1, placeholder: '例如：事假、病假、特休、婚假等' },
        { label: '開始時間', type_1: 'datetime', required: true, order: 2 },
        { label: '結束時間', type_1: 'datetime', required: true, order: 3 },
        { label: '事由', type_1: 'textarea', order: 4, placeholder: '請說明請假原因' },
      ]

      for (const field of fields) {
        await FormField.create({ ...field, form: form._id })
      }

      // Create workflow for leave form
      const steps = [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ]
      
      await ApprovalWorkflow.create({
        form: form._id,
        steps,
        policy: { maxApprovalLevel: 5, allowDelegate: false, overdueDays: 3, overdueAction: 'none' }
      })

      console.log('Auto-generated leave form template')
    }

    // Return the form with its fields and workflow
    const fields = await FormField.find({ form: form._id, is_active: true }).sort({ order: 1 })
    const workflow = await ApprovalWorkflow.findOne({ form: form._id })
    
    res.json({ 
      form, 
      fields, 
      workflow,
      generated: !form.createdAt || (new Date() - form.createdAt < 5000) // true if just created
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
