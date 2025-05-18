import mongoose from 'mongoose';

const payrollRecordSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month: { type: Date, required: true },
  amount: { type: Number, required: true }
}, { timestamps: true });

export default mongoose.model('PayrollRecord', payrollRecordSchema);
