import mongoose from 'mongoose';
import SubDepartment from '../models/SubDepartment.js';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import AttendanceSetting from '../models/AttendanceSetting.js';

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
          return res.status(400).json({ error: 'Department not found' });
        }
        filter.department = dept._id;
      }
    }

    const subDepts = await SubDepartment.find(filter);
    res.json(subDepts.map(formatSubDepartment));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSubDepartment(req, res) {
  try {
    const subDept = new SubDepartment(await sanitizeSchedulingFields(mapShiftPayload(req.body)));
    await subDept.save();
    res.status(201).json(formatSubDepartment(subDept));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSubDepartment(req, res) {
  try {
    const subDept = await SubDepartment.findByIdAndUpdate(
      req.params.id,
      await sanitizeSchedulingFields(mapShiftPayload(req.body)),
      { new: true }
    );
    if (!subDept) return res.status(404).json({ error: 'Not found' });
    res.json(formatSubDepartment(subDept));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteSubDepartment(req, res) {
  try {
    const subDept = await SubDepartment.findByIdAndDelete(req.params.id);
    if (!subDept) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
