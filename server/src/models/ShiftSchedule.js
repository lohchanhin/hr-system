import mongoose from 'mongoose';

const shiftScheduleSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, required: true }
}, { timestamps: true });

shiftScheduleSchema.index({ employee: 1, date: 1 }, { unique: true });

export default mongoose.model('ShiftSchedule', shiftScheduleSchema);
