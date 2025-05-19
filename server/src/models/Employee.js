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

  status: { type: String, default: '在職' }
}, { timestamps: true });

export default mongoose.model('Employee', employeeSchema);
