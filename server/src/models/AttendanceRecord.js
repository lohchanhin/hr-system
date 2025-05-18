import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  action: { type: String, enum: ['clockIn', 'clockOut', 'outing', 'breakIn'], required: true },
  timestamp: { type: Date, default: Date.now },
  remark: String
});

export default mongoose.model('AttendanceRecord', attendanceSchema);
