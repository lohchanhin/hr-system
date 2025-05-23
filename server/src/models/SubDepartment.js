import mongoose from 'mongoose';

const subDepartmentSchema = new mongoose.Schema({
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  // 小單位代碼
  code: String,
  // 小單位名稱
  name: String,
  // 單位名稱
  unitName: String,
  // 位置
  location: String,
  // 連絡電話
  phone: String,
  // 部門主管
  manager: String,
  headcount: Number,
  scheduleSetting: String
}, { timestamps: true });

export default mongoose.model('SubDepartment', subDepartmentSchema);
