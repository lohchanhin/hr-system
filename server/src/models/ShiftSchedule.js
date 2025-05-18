import mongoose from 'mongoose';

const shiftScheduleSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  shiftType: { type: String, required: true }
}, { timestamps: true });

export default mongoose.model('ShiftSchedule', shiftScheduleSchema);
