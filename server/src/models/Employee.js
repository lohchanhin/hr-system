import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },


  email: { type: String, unique: true },
  role: {
    type: String,
    enum: ['employee', 'supervisor', 'hr', 'admin'],
    default: 'employee'
  },
  department: String,
  title: String,

  // 新增欄位
  idNumber: { type: String, default: '' }, // 身分證字號
  birthDate: Date, // 出生日期
  contact: { type: String, default: '' }, // 聯絡方式
  licenses: { type: [String], default: [] }, // 證照
  trainings: { type: [String], default: [] }, // 教育訓練

  status: { type: String, default: '在職' }
}, { timestamps: true });

export default mongoose.model('Employee', employeeSchema);
