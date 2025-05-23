import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  // 部門名稱
  name: String,
  // 部門代碼
  code: String,
  // 單位名稱
  unitName: String,
  // 位置
  location: String,
  // 連絡電話
  phone: String,
  // 部門主管
  manager: String,
  // 所屬機構
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true }
}, { timestamps: true });

export default mongoose.model('Department', departmentSchema);
