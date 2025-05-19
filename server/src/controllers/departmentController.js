import Department from '../models/Department.js';

export async function listDepartments(req, res) {
  try {
    const departments = await Department.find();
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDepartment(req, res) {
  try {
    const dept = new Department(req.body);
    await dept.save();
    res.status(201).json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateDepartment(req, res) {
  try {
    const dept = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
