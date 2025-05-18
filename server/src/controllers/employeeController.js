import Employee from '../models/Employee.js';

export async function listEmployees(req, res) {
  const employees = await Employee.find();
  res.json(employees);
}

export async function createEmployee(req, res) {
  try {
    const employee = new Employee(req.body);
    await employee.save();
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
