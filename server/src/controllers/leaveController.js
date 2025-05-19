import LeaveRequest from '../models/LeaveRequest.js';

export async function listLeaves(req, res) {
  try {
    const leaves = await LeaveRequest.find().populate('employee');
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createLeave(req, res) {
  try {
    const leave = new LeaveRequest(req.body);
    await leave.save();
    res.status(201).json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getLeave(req, res) {
  try {
    const leave = await LeaveRequest.findById(req.params.id).populate('employee');
    if (!leave) return res.status(404).json({ error: 'Not found' });
    res.json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateLeave(req, res) {
  try {
    const leave = await LeaveRequest.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!leave) return res.status(404).json({ error: 'Not found' });
    res.json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteLeave(req, res) {
  try {
    const leave = await LeaveRequest.findByIdAndDelete(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
