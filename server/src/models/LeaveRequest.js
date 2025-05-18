import mongoose from 'mongoose'

const leaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  leaveType: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: String,
  status: { type: String, default: 'pending' }
}, { timestamps: true })

export default mongoose.model('LeaveRequest', leaveSchema)
