// 機構 > 部門 > 小單位的參照檢查與連動（organization / department / subDepartment 控制器共用）。
// 資料庫是單機模式（沒有交易、沒有外鍵）：
// - 刪除前先看還有沒有人用：底下還有部門／小單位／員工，或簽核流程的「群組」關卡指定了這個小單位時不刪除（409 IN_USE），
//   不然員工資料會留著一個已經不存在的機構／部門／小單位（部門的「使用簽核表單」限制失效、排班人員看不到這些人、畫面顯示一串編號）。
// - 部門改到別的機構、小單位改到別的部門時，底下員工的機構／部門跟著改，員工資料才不會和組織架構對不起來
//   （簽核的機構範圍、員工清單與薪資的機構篩選看的是員工資料上的機構）。
import Department from '../models/Department.js';
import SubDepartment from '../models/SubDepartment.js';
import Employee from '../models/Employee.js';
import ApprovalWorkflow from '../models/approval_workflow.js';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export const IN_USE_CODE = 'IN_USE';

export function isObjectIdText(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function idText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) return idText(value._id);
  return String(value);
}

/** 機構還被誰使用：{ departments, employees } */
export async function organizationUsage(id) {
  const [departments, employees] = await Promise.all([
    Department.countDocuments({ organization: id }),
    Employee.countDocuments({ organization: String(id) }),
  ]);
  return { departments, employees };
}

/** 部門還被誰使用：{ subDepartments, employees } */
export async function departmentUsage(id) {
  const [subDepartments, employees] = await Promise.all([
    SubDepartment.countDocuments({ department: id }),
    Employee.countDocuments({ department: id }),
  ]);
  return { subDepartments, employees };
}

/** 小單位還被誰使用：{ employees, workflowSteps }（workflowSteps：簽核流程裡指定這個小單位的「群組」關卡數） */
export async function subDepartmentUsage(id) {
  const target = String(id).toLowerCase();
  const [employees, workflows] = await Promise.all([
    Employee.countDocuments({ subDepartment: id }),
    ApprovalWorkflow.find({ 'steps.approver_type': 'group' }).select('steps.approver_type steps.approver_value').lean(),
  ]);
  let workflowSteps = 0;
  for (const workflow of workflows || []) {
    for (const step of workflow.steps || []) {
      if (step?.approver_type !== 'group') continue;
      const values = Array.isArray(step.approver_value) ? step.approver_value : [step.approver_value];
      if (values.some((value) => idText(value?.value ?? value?.id ?? value).toLowerCase() === target)) workflowSteps += 1;
    }
  }
  return { employees, workflowSteps };
}

const USAGE_TEXT = {
  departments: (count) => `${count} 個部門`,
  subDepartments: (count) => `${count} 個小單位`,
  employees: (count) => `${count} 位員工`,
  workflowSteps: (count) => `${count} 個簽核流程的「群組」關卡`,
};

export function isInUse(usage) {
  return Object.values(usage || {}).some((count) => Number(count) > 0);
}

/** 不能刪除時給管理員看的說明，例如「「護理部」還有 3 個小單位、12 位員工在使用，請先移到其他部門或刪除後，再刪除這個部門」 */
export function inUseMessage(kind, name, usage) {
  const parts = Object.entries(usage || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => USAGE_TEXT[key]?.(count))
    .filter(Boolean);
  const label = name ? `「${name}」` : `這個${kind}`;
  const advice = kind === '機構'
    ? '請先把它們移到其他機構或刪除後，再刪除這個機構'
    : kind === '部門'
      ? '請先把它們移到其他部門或刪除後，再刪除這個部門'
      : '請先把員工移到其他小單位、調整簽核流程後，再刪除這個小單位';
  return `${label}還有 ${parts.join('、')}在使用，${advice}`;
}

/** 部門改了所屬機構：這個部門的員工跟著改到新的機構。回傳更新的人數 */
export async function syncDepartmentEmployees(department) {
  const departmentId = idText(department?._id);
  const organizationId = idText(department?.organization);
  if (!isObjectIdText(departmentId) || !isObjectIdText(organizationId)) return 0;
  const result = await Employee.updateMany(
    { department: departmentId, organization: { $ne: organizationId } },
    { $set: { organization: organizationId } },
  );
  return result?.modifiedCount ?? 0;
}

/** 小單位改了所屬部門：這個小單位的員工跟著改到新的部門（與那個部門的機構）。回傳更新的人數 */
export async function syncSubDepartmentEmployees(subDepartment) {
  const subDepartmentId = idText(subDepartment?._id);
  const departmentId = idText(subDepartment?.department);
  if (!isObjectIdText(subDepartmentId) || !isObjectIdText(departmentId)) return 0;
  const department = await Department.findById(departmentId).select('organization').lean();
  // 找不到新的部門（資料異常）就不動員工資料
  if (!department) return 0;
  const organizationId = idText(department.organization);
  const update = { department: departmentId };
  if (isObjectIdText(organizationId)) update.organization = organizationId;
  const moved = { subDepartment: subDepartmentId, department: { $ne: departmentId } };
  const result = await Employee.updateMany(moved, { $set: update });
  return result?.modifiedCount ?? 0;
}

// 機構／部門／小單位欄位的中文名稱（驗證失敗時告訴管理員是哪一格）
const FIELD_LABELS = {
  name: '名稱',
  code: '代碼',
  unitName: '單位名稱',
  institutionCode: '機構代碼',
  systemCode: '系統代碼',
  uniformNumber: '統一編號',
  laborInsuranceNumber: '勞保證號',
  healthInsuranceNumber: '健保編號',
  taxRegistrationNumber: '稅籍編號',
  location: '位置',
  phone: '連絡電話',
  responsiblePerson: '負責人',
  manager: '主管',
  scheduleNotes: '排班備註',
  organization: '所屬機構',
  department: '所屬部門',
  deptManager: '排班管理者',
  headcount: '人力需求數',
  shift: '班表拉選',
};

/* 一個欄位的驗證錯誤 → 中文；schema 自訂的訊息（例如「統一編號需為 8 碼數字」）本來就是中文，原樣使用 */
function describeFieldError(path, fieldError) {
  const label = FIELD_LABELS[path] || path;
  const kind = fieldError?.kind;
  if (kind === 'required') return `請填寫${label}`;
  if (kind === 'maxlength') return `${label}最多 ${fieldError?.properties?.maxlength ?? ''} 個字`;
  if (kind === 'min' || kind === 'max') return `${label}超出可以填的範圍`;
  if (fieldError?.name === 'CastError' || kind === 'ObjectId' || kind === 'Number' || kind === 'Boolean' || kind === 'Date') {
    return `${label}格式不正確`;
  }
  const message = String(fieldError?.message || '');
  return /[一-鿿]/.test(message) ? message : `${label}格式不正確`;
}

/**
 * 新增、修改、刪除機構／部門／小單位失敗時的回應（三個控制器共用）。
 * 以前直接回 err.message：Mongoose 的「Organization validation failed: name: Path `name` is required.」、
 * 資料庫的 E11000 原文（含集合名稱）、Cast to ObjectId… 都原樣顯示給管理員。
 * - 自己丟出的中文錯誤（例如「使用班別包含不存在的班別」）照原文 400
 * - 驗證失敗：每個欄位一句中文，400 VALIDATION_FAILED，fields 列出欄位
 * - 編號格式不對：400 INVALID_ID；重複：409 DUPLICATE；其他非預期錯誤：讀取 500、寫入 400（和以前相同），只記錄錯誤名稱
 */
export function respondOrgError(res, err, kind = '資料', action = '儲存') {
  if (err?.name === 'ValidationError' && err.errors) {
    const entries = Object.entries(err.errors);
    return res.status(400).json({
      error: entries.map(([path, fieldError]) => describeFieldError(path, fieldError)).join('；') || `${kind}資料格式不正確`,
      code: 'VALIDATION_FAILED',
      fields: entries.map(([path]) => path),
    });
  }
  if (err?.name === 'CastError') {
    const field = FIELD_LABELS[err.path];
    return res.status(400).json({
      error: field && err.path !== '_id' ? `${field}格式不正確` : `找不到這筆${kind}資料（編號格式不正確），請重新整理後再試`,
      code: 'INVALID_ID',
    });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: `已經有相同名稱或代碼的${kind}，請換一個`, code: 'DUPLICATE' });
  }
  const message = String(err?.message || '');
  if (err?.name === 'Error' && /[一-鿿]/.test(message)) {
    return res.status(400).json({ error: message });
  }
  console.error(`[${kind}] request failed: ${err?.name || 'Error'}`);
  // 狀態碼維持以前的（讀取 500、新增修改刪除 400），只是不再回英文原文
  return res.status(action === '讀取' ? 500 : 400).json({ error: `${kind}${action}失敗，請確認資料後再試；若持續發生請聯絡系統管理員` });
}

/** 找不到資料（已被刪除）的回應 */
export function notFoundBody(kind) {
  return { error: `找不到這筆${kind}資料，可能已被刪除，請重新整理`, code: 'NOT_FOUND' };
}

export default {
  respondOrgError,
  notFoundBody,
  IN_USE_CODE,
  isObjectIdText,
  organizationUsage,
  departmentUsage,
  subDepartmentUsage,
  isInUse,
  inUseMessage,
  syncDepartmentEmployees,
  syncSubDepartmentEmployees,
};
