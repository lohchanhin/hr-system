import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  shift: { type: String, enum: ['morning', 'evening', 'night'], default: 'morning' }
}, { timestamps: true });

export default mongoose.model('Schedule', scheduleSchema);
