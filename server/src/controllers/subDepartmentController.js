import mongoose from 'mongoose';
import SubDepartment from '../models/SubDepartment.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import AttendanceSetting from '../models/AttendanceSetting.js';
import {
  IN_USE_CODE,
  notFoundBody,
  respondOrgError,
  inUseMessage,
  isInUse,
  isObjectIdText,
  subDepartmentUsage,
  syncSubDepartmentEmployees,
} from '../services/orgStructureService.js';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function readIdList(value, label) {
  if (value === null || value === '') return [];
  if (!Array.isArray(value)) throw new Error(`${label}格式不正確`);
  const ids = Array.from(new Set(value.map((item) => String(item?._id ?? item ?? '').trim()).filter(Boolean)));
  if (ids.some((id) => !OBJECT_ID_PATTERN.test(id))) throw new Error(`${label}格式不正確`);
  return ids;
}

/**
 * 排班人員（schedulers：員工 _id，任何角色都可以）與使用班別（allowedShiftIds：班別設定的 _id，空陣列代表全部班別）：
 * 檢查格式、是否存在並去掉重複；沒送的欄位不動（舊畫面修改小單位時不會清掉設定）。不正確時丟出錯誤（回 400）。
 */
async function sanitizeSchedulingFields(data) {
  if (Object.prototype.hasOwnProperty.call(data, 'schedulers')) {
    const ids = readIdList(data.schedulers, '排班人員');
    if (ids.length) {
      const found = await Employee.find({ _id: { $in: ids } }).select('_id').lean();
      if ((found || []).length !== ids.length) throw new Error('排班人員包含不存在的員工，請重新選擇');
    }
    data.schedulers = ids;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'allowedShiftIds')) {
    const ids = readIdList(data.allowedShiftIds, '使用班別');
    if (ids.length) {
      const setting = await AttendanceSetting.findOne().select('shifts._id').lean();
      const knownShiftIds = new Set((setting?.shifts || []).map((shift) => String(shift?._id)));
      if (ids.some((id) => !knownShiftIds.has(id))) throw new Error('使用班別包含不存在的班別，請重新選擇');
    }
    data.allowedShiftIds = ids;
  }
  return data;
}

function formatSubDepartment(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const shiftValue = plain.shift ?? null;
  return {
    ...plain,
    shiftId: shiftValue ? shiftValue.toString() : '',
  };
}

// 舊欄位「班表拉選」（shift，API 以 shiftId 收送）：設定畫面已不顯示也不送，沒有功能讀取；仍接受舊用法，沒送就不動
function mapShiftPayload(payload = {}) {
  const data = { ...payload };
  if (Object.prototype.hasOwnProperty.call(data, 'shiftId')) {
    data.shift = data.shiftId || null;
    delete data.shiftId;
  }
  if (data.shift === '') {
    data.shift = null;
  }
  return data;
}

export async function listSubDepartments(req, res) {
  try {
    const filter = {};
    const { department } = req.query;

    if (department) {
      if (mongoose.Types.ObjectId.isValid(department)) {
        filter.department = department;
      } else {
        const dept = await Department.findOne({ name: department });
        if (!dept) {
          return res.status(400).json({ error: '找不到這個部門，請重新選擇', code: 'DEPARTMENT_NOT_FOUND' });
        }
        filter.department = dept._id;
      }
    }

    const subDepts = await SubDepartment.find(filter);
    res.json(subDepts.map(formatSubDepartment));
  } catch (err) {
    respondOrgError(res, err, '小單位', '讀取');
  }
}

export async function createSubDepartment(req, res) {
  try {
    const subDept = new SubDepartment(await sanitizeSchedulingFields(mapShiftPayload(req.body)));
    await subDept.save();
    res.status(201).json(formatSubDepartment(subDept));
  } catch (err) {
    respondOrgError(res, err, '小單位');
  }
}

export async function updateSubDepartment(req, res) {
  try {
    const payload = await sanitizeSchedulingFields(mapShiftPayload(req.body));
    const subDept = await SubDepartment.findByIdAndUpdate(
      req.params.id,
      payload,
      // runValidators：修改時和新增一樣檢查必填與格式（以前把名稱清空也存得進去）；沒送的欄位不檢查也不動
      { new: true, runValidators: true }
    );
    if (!subDept) return res.status(404).json(notFoundBody('小單位'));
    // 小單位改到別的部門：這個小單位的員工跟著改到新的部門與機構
    if (payload.department !== undefined && isObjectIdText(String(req.params.id))) {
      try {
        await syncSubDepartmentEmployees(subDept);
      } catch (syncError) {
        console.error(`[subDepartment] sync employee department failed: ${syncError?.name || 'Error'}`);
      }
    }
    res.json(formatSubDepartment(subDept));
  } catch (err) {
    respondOrgError(res, err, '小單位');
  }
}

export async function deleteSubDepartment(req, res) {
  try {
    // 還有員工、或簽核流程的「群組」關卡指定這個小單位時不刪除：員工會留著不存在的小單位，用到那一關的表單會送不出去
    if (isObjectIdText(req.params.id)) {
      const usage = await subDepartmentUsage(req.params.id);
      if (isInUse(usage)) {
        const current = await SubDepartment.findById(req.params.id).select('name').lean();
        if (!current) return res.status(404).json(notFoundBody('小單位'));
        return res.status(409).json({ error: inUseMessage('小單位', current.name, usage), code: IN_USE_CODE, usage });
      }
    }
    const subDept = await SubDepartment.findByIdAndDelete(req.params.id);
    if (!subDept) return res.status(404).json(notFoundBody('小單位'));
    res.json({ success: true });
  } catch (err) {
    respondOrgError(res, err, '小單位');
  }
}
