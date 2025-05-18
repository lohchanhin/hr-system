import mongoose from 'mongoose';

const approvalSchema = new mongoose.Schema({
  applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  type: { type: String, required: true },
  content: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

export default mongoose.model('Approval', approvalSchema);
