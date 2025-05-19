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
    const employee = new Employee({ name, email, role, department, title, status });
    await employee.save();
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
