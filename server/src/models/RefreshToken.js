import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    // 發出時員工的登入版本；舊資料沒有這個欄位（null）時不比對
    authVersion: { type: Number, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('RefreshToken', refreshTokenSchema);
