import Department from '../models/Department.js';
import FormTemplate from '../models/form_template.js';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * 使用簽核表單（allowedFormIds）：表單 _id 陣列，空陣列代表全部表單；沒有送這個欄位就回傳 undefined（修改時不動原本的設定）。
 * 格式不對或表單不存在時丟出錯誤（回 400）。
 */
async function readAllowedFormIds(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, 'allowedFormIds')) return undefined;
  const raw = body.allowedFormIds;
  if (raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new Error('使用簽核表單格式不正確');
  const ids = Array.from(new Set(raw.map((value) => String(value?._id ?? value ?? '').trim()).filter(Boolean)));
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) throw new Error('使用簽核表單格式不正確');
  if (ids.length) {
    const found = await FormTemplate.find({ _id: { $in: ids } }).select('_id').lean();
    if ((found || []).length !== ids.length) throw new Error('使用簽核表單包含不存在的表單，請重新選擇');
  }
  return ids;
}

export async function listDepartments(req, res) {
  try {
    const filter = {};
    if (req.query.organization) {
      filter.organization = req.query.organization;
    }
    const departments = await Department.find(filter);
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDepartment(req, res) {
  try {
    const {
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes
    } = req.body;
    const dept = new Department({
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes,
      allowedFormIds: (await readAllowedFormIds(req.body)) ?? []
    });
    await dept.save();
    res.status(201).json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateDepartment(req, res) {
  try {
    const {
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes
    } = req.body;
    // 使用簽核表單：有送才更新（舊畫面沒有這個欄位時不會清掉設定）
    const allowedFormIds = await readAllowedFormIds(req.body);
    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      {
        ...(allowedFormIds !== undefined ? { allowedFormIds } : {}),
        name,
        code,
        unitName,
        institutionCode,
        uniformNumber,
        laborInsuranceNumber,
        healthInsuranceNumber,
        taxRegistrationNumber,
        location,
        phone,
        responsiblePerson,
        manager,
        organization,
        defaultTwoDayOff,
        tempChangeAllowed,
        deptManager,
        scheduleNotes
      },
      { new: true }
    );
    if (!dept) return res.status(404).json({ error: 'Not found' });
    res.json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteDepartment(req, res) {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
