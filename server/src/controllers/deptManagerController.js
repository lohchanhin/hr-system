import Employee from '../models/Employee.js';

export async function listDeptManagers(req, res) {
  try {
    // 找出具有主管或管理員角色的員工
    const managers = await Employee.find({ role: { $in: ['supervisor', 'admin'] } }).select('name');
    // 轉換為前端需要的 { label, value } 格式
    const result = managers.map(mgr => ({ label: mgr.name, value: mgr._id }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
