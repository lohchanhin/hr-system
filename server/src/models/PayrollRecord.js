import mongoose from 'mongoose';

const payrollRecordSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month: { type: Date, required: true }, // 薪資月份
  
  // Stage A: 基本薪資與扣款項目
  baseSalary: { type: Number, default: 0 }, // 基本薪資/合計
  laborInsuranceFee: { type: Number, default: 0 }, // 勞保費自付額
  healthInsuranceFee: { type: Number, default: 0 }, // 健保費自付額
  laborPensionSelf: { type: Number, default: 0 }, // 勞退個人提繳
  employeeAdvance: { type: Number, default: 0 }, // 員工借支
  debtGarnishment: { type: Number, default: 0 }, // 債權扣押
  otherDeductions: { type: Number, default: 0 }, // 其他扣款
  netPay: { type: Number, default: 0 }, // 實領金額 (Stage A)
  
  // Stage B: 獎金項目
  nightShiftAllowance: { type: Number, default: 0 }, // 夜班補助津貼
  performanceBonus: { type: Number, default: 0 }, // 人力績效獎金
  otherBonuses: { type: Number, default: 0 }, // 其他獎金
  totalBonus: { type: Number, default: 0 }, // 獎金合計 (Stage B)
  
  // 銀行帳戶資訊 (從員工資料複製)
  bankAccountA: {
    bank: String,
    bankCode: String, // 銀行代碼
    branchCode: String, // 分行代碼
    accountNumber: String,
    accountName: String
  },
  bankAccountB: {
    bank: String,
    bankCode: String,
    branchCode: String,
    accountNumber: String,
    accountName: String
  },
  
  // 勞保等級
  insuranceLevel: { type: Number }, // 對應 LaborInsuranceRate 的 level
  
  // Legacy field for backward compatibility
  amount: { type: Number, default: 0 },
  
  // 備註
  notes: String
}, { timestamps: true });

// 索引
payrollRecordSchema.index({ employee: 1, month: 1 }, { unique: true });
payrollRecordSchema.index({ month: 1 });

export default mongoose.model('PayrollRecord', payrollRecordSchema);
