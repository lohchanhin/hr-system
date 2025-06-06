import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['employee', 'supervisor', 'admin'],
    default: 'employee'
  },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  organization: String,
  department: String,
  subDepartment: String,
  supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);
