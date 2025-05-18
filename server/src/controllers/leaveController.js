import Leave from '../models/Leave.js';

export async function listLeaves(req, res) {
  const leaves = await Leave.find().populate('employee');
  res.json(leaves);
}

export async function createLeave(req, res) {
  try {
    const leave = new Leave(req.body);
    await leave.save();
    res.status(201).json(leave);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
