import Employee from '../models/Employee.js';

const INACTIVE_EMPLOYMENT_STATUSES = new Set(['離職員工', '留職停薪']);

export async function listDeptManagers(req, res) {
  try {
    // 排班管理者、排班人員的選單：任何角色的員工都可以擔任（主管欄位仍只作為簽核使用）。
    // 離職、留職停薪或停用帳號的員工標示 active: false，畫面只在已被指定時顯示（讓舊設定看得到名字）
    const employees = await Employee.find({})
      .select('name employeeId role status accountEnabled department subDepartment')
      .sort({ name: 1, employeeId: 1 })
      .lean();
    // 轉換為前端需要的 { label, value } 格式，另附搜尋與顯示用的員工代號、角色、部門
    const result = employees.map(emp => ({
      label: emp.name,
      value: emp._id,
      employeeId: emp.employeeId || '',
      role: emp.role || 'employee',
      department: emp.department || null,
      subDepartment: emp.subDepartment || null,
      active: emp.accountEnabled !== false && !INACTIVE_EMPLOYMENT_STATUSES.has(emp.status),
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
