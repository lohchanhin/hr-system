import SubDepartment from '../models/SubDepartment.js';

export async function listSubDepartments(req, res) {
  try {
    const subDepts = await SubDepartment.find();
    res.json(subDepts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSubDepartment(req, res) {
  try {
    const subDept = new SubDepartment(req.body);
    await subDept.save();
    res.status(201).json(subDept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSubDepartment(req, res) {
  try {
    const subDept = await SubDepartment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!subDept) return res.status(404).json({ error: 'Not found' });
    res.json(subDept);
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
