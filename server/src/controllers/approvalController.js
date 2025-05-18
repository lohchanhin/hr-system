import Approval from '../models/Approval.js';

export async function listApprovals(req, res) {
  const approvals = await Approval.find().populate('applicant');
  res.json(approvals);
}

export async function approve(req, res) {
  try {
    const approval = await Approval.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );
    if (!approval) return res.status(404).json({ error: 'Not found' });
    res.json(approval);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function reject(req, res) {
  try {
    const approval = await Approval.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );
    if (!approval) return res.status(404).json({ error: 'Not found' });
    res.json(approval);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
