import mongoose from 'mongoose';

const laborInsuranceRateSchema = new mongoose.Schema({
  level: { type: Number, required: true, unique: true }, // 序號 1-28
  ordinaryRate: { type: Number, required: true, default: 11.5 }, // 勞保普通費率 (%)
  employmentInsuranceRate: { type: Number, required: true, default: 1.0 }, // 就保費率 (%)
  insuredSalary: { type: Number, required: true }, // 投保薪資
  workerFee: { type: Number, required: true }, // 勞工應負擔保費金額
  employerFee: { type: Number, required: true } // 單位應負擔保費金額
}, { timestamps: true });

laborInsuranceRateSchema.index({ level: 1 }, { unique: true });
laborInsuranceRateSchema.index({ insuredSalary: 1 });

export default mongoose.model('LaborInsuranceRate', laborInsuranceRateSchema);
