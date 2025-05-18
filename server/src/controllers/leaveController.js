
import LeaveRequest from '../models/LeaveRequest.js'

export async function listLeaveRequests (req, res) {
  const leaves = await LeaveRequest.find().populate('employee')
  res.json(leaves)
}

export async function createLeaveRequest (req, res) {
  try {
    const leave = new LeaveRequest(req.body)
    await leave.save()
    res.status(201).json(leave)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}
