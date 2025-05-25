import Employee from '../models/Employee.js';
import User from '../models/User.js';

export async function listEmployees(req, res) {
  try {
    const filter = req.query.supervisor
      ? { supervisor: req.query.supervisor }
      : {};
    const employees = await Employee.find(filter);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createEmployee(req, res) {
  try {
    const { name, email, role, organization, department, subDepartment, title, status, username, password, supervisor } = req.body;
    const sup = supervisor === '' ? undefined : supervisor;
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
      const validRoles = ['employee', 'supervisor', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }
    const employee = new Employee({ name, email, role, organization, department, subDepartment, title, status, supervisor: sup });
    await employee.save();
    await User.create({ username, password, role, organization, department, subDepartment, employee: employee._id, supervisor: sup });
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

    const { name, email, role, organization, department, subDepartment, title, status, supervisor } = req.body;
    const sup = supervisor === '' ? undefined : supervisor;
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
      const validRoles = ['employee', 'supervisor', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }
    if (name !== undefined) employee.name = name;
    if (email !== undefined) employee.email = email;
    if (role !== undefined) employee.role = role;
    if (organization !== undefined) employee.organization = organization;
    if (department !== undefined) employee.department = department;
    if (subDepartment !== undefined) employee.subDepartment = subDepartment;
    if (title !== undefined) employee.title = title;
    if (status !== undefined) employee.status = status;
    if (sup !== undefined) employee.supervisor = sup;

    await employee.save();
    const updateObj = {};
    if (sup !== undefined) updateObj.supervisor = sup;
    if (organization !== undefined) updateObj.organization = organization;
    if (department !== undefined) updateObj.department = department;
    if (subDepartment !== undefined) updateObj.subDepartment = subDepartment;
    if (Object.keys(updateObj).length > 0) {
      await User.findOneAndUpdate({ employee: employee._id }, updateObj);
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
