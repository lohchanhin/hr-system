import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
  // 機構名稱（必填：沒有名稱的機構在選單裡是一列空白）
  name: { type: String, required: true, trim: true, maxlength: 120 },
  // 系統代碼
  systemCode: String,
  // 單位名稱
  unitName: String,
  // 機構代碼
  orgCode: String,
  // 統一編號
  taxIdNumber: String,
  // 勞保編號
  laborInsuranceNo: String,
  // 健保編號
  healthInsuranceNo: String,
  // 稅籍編號
  taxCode: String,
  // 位置
  address: String,
  // 連絡電話
  phone: String,
  // 負責人
  principal: String
}, { timestamps: true });

export default mongoose.model('Organization', organizationSchema);
