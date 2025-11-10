import mongoose from 'mongoose';

const shiftScheduleSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  subDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'SubDepartment' },
  state: {
    type: String,
    enum: ['draft', 'pending_confirmation', 'finalized'],
    default: 'draft',
    index: true,
  },
  publishedAt: { type: Date },
  employeeResponse: {
    type: String,
    enum: ['pending', 'confirmed', 'disputed'],
    default: 'pending',
    index: true,
  },
  responseNote: { type: String, default: '' },
  responseAt: { type: Date },
}, { timestamps: true });

shiftScheduleSchema.index({ employee: 1, date: 1 }, { unique: true });
shiftScheduleSchema.index({ department: 1, date: 1 });
shiftScheduleSchema.index({ date: 1, state: 1 });

export default mongoose.model('ShiftSchedule', shiftScheduleSchema);
