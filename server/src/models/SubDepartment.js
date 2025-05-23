import mongoose from 'mongoose';

const subDepartmentSchema = new mongoose.Schema({
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  code: String,
  name: String,
  phone: String,
  manager: String,
  headcount: Number,
  scheduleSetting: String
}, { timestamps: true });

export default mongoose.model('SubDepartment', subDepartmentSchema);
