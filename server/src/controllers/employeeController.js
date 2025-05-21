import Employee from '../models/Employee.js';

export async function listEmployees(req, res) {
  try {
    const employees = await Employee.find();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createEmployee(req, res) {
  try {
    const { name, email, role, department, title, status } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const employee = new Employee({ name, email, role, department, title, status });
    await employee.save();
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


export async function getEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Not found' });
    res.json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Not found' });

    const { name, email, role, department, title, status } = req.body;
    if (name !== undefined) employee.name = name;
    if (email !== undefined) employee.email = email;
    if (role !== undefined) employee.role = role;
    if (department !== undefined) employee.department = department;
    if (title !== undefined) employee.title = title;
    if (status !== undefined) employee.status = status;

    await employee.save();
    res.json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteEmployee(req, res) {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
