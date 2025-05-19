import mongoose from 'mongoose';

const attendanceManagementSettingSchema = new mongoose.Schema({
  enableImport: { type: Boolean, default: false },
  importFormat: String,
  importMapping: String,
  allowMakeUpClock: { type: Boolean, default: true },
  makeUpDays: Number,
  makeUpNeedApprove: { type: Boolean, default: true },
  supervisorCrossDept: { type: Boolean, default: false },
  hrAllDept: { type: Boolean, default: true },
  employeeHistoryMonths: Number,
  nonExtWorkAlert: { type: Boolean, default: false },
  overtimeNoClockNotify: { type: Boolean, default: true },
  notifyTargets: [String]
}, { timestamps: true });

export default mongoose.model('AttendanceManagementSetting', attendanceManagementSettingSchema);
