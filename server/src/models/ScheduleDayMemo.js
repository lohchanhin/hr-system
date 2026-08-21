import mongoose from 'mongoose';

const scheduleDayMemoSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  subDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'SubDepartment', default: null },
  content: { type: String, trim: true, maxlength: 1000, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
}, { timestamps: true });

scheduleDayMemoSchema.index(
  { date: 1, department: 1, subDepartment: 1 },
  { unique: true }
);
scheduleDayMemoSchema.index({ department: 1, subDepartment: 1, date: 1 });

export default mongoose.model('ScheduleDayMemo', scheduleDayMemoSchema);
