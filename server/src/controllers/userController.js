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
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (req.body.username !== undefined) user.username = req.body.username;
    if (req.body.password) user.password = req.body.password;
    if (req.body.role !== undefined) user.role = req.body.role;
    if (req.body.organization !== undefined) user.organization = req.body.organization;
    if (req.body.department !== undefined) user.department = req.body.department;
    if (req.body.subDepartment !== undefined) user.subDepartment = req.body.subDepartment;
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
