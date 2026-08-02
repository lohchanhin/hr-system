import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  action: { type: String, enum: ['clockIn', 'clockOut', 'outing', 'breakIn'], required: true },
  timestamp: { type: Date, default: Date.now },
  remark: String,
  punchKey: { type: String, select: false, immutable: true }
});

attendanceSchema.index(
  { punchKey: 1 },
  { unique: true, sparse: true, name: 'attendance_punch_key_unique' }
);

export default mongoose.model('AttendanceRecord', attendanceSchema);
