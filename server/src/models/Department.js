import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  label: String,
  value: String
}, { timestamps: true });

export default mongoose.model('Department', departmentSchema);
