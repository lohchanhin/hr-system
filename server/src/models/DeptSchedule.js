import mongoose from 'mongoose';

const deptScheduleSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    rules: [
      {
        dayOfWeek: Number,
        shiftType: String
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.model('DeptSchedule', deptScheduleSchema);
