import User from '../models/User.js';

export async function listUsers(req, res) {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createUser(req, res) {
  try {
    const { username, password, role, organization, department, subDepartment } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });
    if (!password) return res.status(400).json({ error: 'password is required' });
    if (!role) return res.status(400).json({ error: 'role is required' });
    const allowed = ['employee', 'supervisor', 'admin'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'invalid role' });
    const user = new User({ username, password, role, organization, department, subDepartment });
    await user.save();
    const plain = user.toObject();
    delete plain.password;
    res.status(201).json(plain);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateUser(req, res) {
  try {
    const { username, password, role, organization, department, subDepartment } = req.body;
    if (!username) return res.status(400).json({ error: 'username is required' });
    if (!password) return res.status(400).json({ error: 'password is required' });
    if (!role) return res.status(400).json({ error: 'role is required' });
    const allowed = ['employee', 'supervisor', 'admin'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'invalid role' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.username = username;
    user.password = password;
    user.role = role;
    if (organization !== undefined) user.organization = organization;
    if (department !== undefined) user.department = department;
    if (subDepartment !== undefined) user.subDepartment = subDepartment;
    await user.save();
    const plain = user.toObject();
    delete plain.password;
    res.json(plain);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteUser(req, res) {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
