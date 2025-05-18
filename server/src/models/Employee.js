import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ['employee', 'supervisor', 'hr', 'admin'], default: 'employee' }
}, { timestamps: true });

export default mongoose.model('Employee', employeeSchema);
