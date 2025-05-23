import Organization from '../models/Organization.js';

export async function listOrganizations(req, res) {
  try {
    const organizations = await Organization.find();
    res.json(organizations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createOrganization(req, res) {
  try {
    const org = new Organization(req.body);
    await org.save();
    res.status(201).json(org);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateOrganization(req, res) {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json(org);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteOrganization(req, res) {
  try {
    const org = await Organization.findByIdAndDelete(req.params.id);
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
