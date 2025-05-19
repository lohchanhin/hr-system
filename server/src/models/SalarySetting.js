import mongoose from 'mongoose';

const salarySettingSchema = new mongoose.Schema({
  salaryItems: { type: Array, default: [] },
  grades: { type: Array, default: [] },
  adjust: { type: Object, default: {} },
  payment: { type: Object, default: {} },
  other: { type: Object, default: {} }
}, { timestamps: true });

export default mongoose.model('SalarySetting', salarySettingSchema);
