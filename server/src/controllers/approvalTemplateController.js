import FormTemplate from '../models/form_template.js'
import FormField from '../models/form_field.js'
import ApprovalWorkflow from '../models/approval_workflow.js'

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
      created_by: req.user?._id, // 若有 auth
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
    const wf = await ApprovalWorkflow.findOneAndUpdate(
      { form: req.params.formId },
      { $set: { steps: Array.isArray(steps) ? steps : [], policy } },
      { new: true, upsert: true }
    )
    res.json(wf)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}
