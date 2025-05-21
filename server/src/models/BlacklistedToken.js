import mongoose from 'mongoose';

const blacklistedTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true, expires: 0 }
});

export default mongoose.model('BlacklistedToken', blacklistedTokenSchema);
