import Department from '../models/Department.js';
import FormTemplate from '../models/form_template.js';
import {
  IN_USE_CODE,
  notFoundBody,
  respondOrgError,
  departmentUsage,
  inUseMessage,
  isInUse,
  isObjectIdText,
  syncDepartmentEmployees,
} from '../services/orgStructureService.js';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * 使用簽核表單（allowedFormIds）：表單 _id 陣列，空陣列代表全部表單；沒有送這個欄位就回傳 undefined（修改時不動原本的設定）。
 * 格式不對時丟出錯誤（回 400）；已經被刪除的表單（畫面上顯示「已刪除的表單」）直接拿掉、不擋下儲存，全部都被刪除時就是空白（全部表單）。
 */
async function readAllowedFormIds(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, 'allowedFormIds')) return undefined;
  const raw = body.allowedFormIds;
  if (raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new Error('使用簽核表單格式不正確');
  const ids = Array.from(new Set(raw.map((value) => String(value?._id ?? value ?? '').trim().toLowerCase()).filter(Boolean)));
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) throw new Error('使用簽核表單格式不正確');
  if (!ids.length) return ids;
  const found = await FormTemplate.find({ _id: { $in: ids } }).select('_id').lean();
  const existing = new Set((found || []).map((form) => String(form._id).toLowerCase()));
  return ids.filter((id) => existing.has(id));
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
    respondOrgError(res, err, '部門', '讀取');
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
    respondOrgError(res, err, '部門');
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
      // runValidators：修改時和新增一樣檢查必填與格式（以前把名稱清空、統一編號填錯也存得進去）；沒送的欄位不檢查也不動
      { new: true, runValidators: true }
    );
    if (!dept) return res.status(404).json(notFoundBody('部門'));
    // 部門改到別的機構：這個部門的員工跟著改，員工資料上的機構才不會和部門對不起來
    if (organization !== undefined && isObjectIdText(String(req.params.id))) {
      try {
        await syncDepartmentEmployees(dept);
      } catch (syncError) {
        // 部門已經存好；員工的機構沒跟上時只記錄，下次儲存部門會再對齊一次
        console.error(`[department] sync employee organization failed: ${syncError?.name || 'Error'}`);
      }
    }
    res.json(dept);
  } catch (err) {
    respondOrgError(res, err, '部門');
  }
}

export async function deleteDepartment(req, res) {
  try {
    // 底下還有小單位或員工時不刪除：不然他們會留著一個不存在的部門（部門的「使用簽核表單」限制失效、排班人員看不到這些人）
    if (isObjectIdText(req.params.id)) {
      const usage = await departmentUsage(req.params.id);
      if (isInUse(usage)) {
        const current = await Department.findById(req.params.id).select('name').lean();
        if (!current) return res.status(404).json(notFoundBody('部門'));
        return res.status(409).json({ error: inUseMessage('部門', current.name, usage), code: IN_USE_CODE, usage });
      }
    }
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) return res.status(404).json(notFoundBody('部門'));
    res.json({ success: true });
  } catch (err) {
    respondOrgError(res, err, '部門');
  }
}
