import mongoose from 'mongoose';

const insuranceRecordSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  provider: String,
  policyNumber: String,
  coverageStart: Date,
  coverageEnd: Date
}, { timestamps: true });

export default mongoose.model('InsuranceRecord', insuranceRecordSchema);
