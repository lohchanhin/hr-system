import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  action: { type: String, enum: ['clockIn', 'clockOut', 'outing', 'breakIn'], required: true },
  timestamp: { type: Date, default: Date.now },
  remark: String,
  punchKey: { type: String, select: false, immutable: true },
  // 打卡來源：online 線上打卡、import 指紋（考勤機）匯入、manual 手動補登。
  // 舊資料沒有這個欄位（視為 legacy），不回填；兩種來源一律並存、互不覆蓋，計算時當成同一組打卡（簽到取最早、簽退取最晚）
  source: { type: String, enum: ['online', 'import', 'manual', 'legacy'], immutable: true }
});

attendanceSchema.index(
  { punchKey: 1 },
  { unique: true, sparse: true, name: 'attendance_punch_key_unique' }
);

// 匯入比對重複打卡、出勤與薪資計算都是「某位員工、某段時間」的查詢
attendanceSchema.index({ employee: 1, timestamp: 1 }, { name: 'attendance_employee_timestamp' });

export default mongoose.model('AttendanceRecord', attendanceSchema);
