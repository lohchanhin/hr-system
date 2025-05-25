import Employee from '../models/Employee.js';
import User from '../models/User.js';

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
    const { name, email, role, department, title, status, username, password, supervisor } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (role !== undefined) {
      const validRoles = ['employee', 'supervisor', 'hr', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }
    const employee = new Employee({ name, email, role, department, title, status, supervisor });
    await employee.save();
    await User.create({ username, password, role, employee: employee._id, department, supervisor });
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

    const { name, email, role, department, title, status, supervisor } = req.body;
    if (email !== undefined) {
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      const emailRegex = /^\S+@\S+\.\S+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
      }
    }
    if (role !== undefined) {
      const validRoles = ['employee', 'supervisor', 'hr', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }
    if (name !== undefined) employee.name = name;
    if (email !== undefined) employee.email = email;
    if (role !== undefined) employee.role = role;
    if (department !== undefined) employee.department = department;
    if (title !== undefined) employee.title = title;
    if (status !== undefined) employee.status = status;
    if (supervisor !== undefined) employee.supervisor = supervisor;

    await employee.save();
    if (supervisor !== undefined) {
      await User.findOneAndUpdate({ employee: employee._id }, { supervisor });
    }
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
