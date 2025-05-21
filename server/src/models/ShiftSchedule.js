import mongoose from 'mongoose';

const shiftScheduleSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  shiftType: { type: String, required: true },
  floor: String,
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  startTime: String,
  endTime: String
}, { timestamps: true });

export default mongoose.model('ShiftSchedule', shiftScheduleSchema);
