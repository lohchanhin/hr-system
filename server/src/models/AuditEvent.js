import mongoose from 'mongoose';

const auditEventSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, immutable: true, index: true },
    requestId: { type: String, default: '', immutable: true },
    actor: {
      id: { type: String, default: '', immutable: true },
      username: { type: String, default: '', immutable: true },
      role: { type: String, default: '', immutable: true },
    },
    action: { type: String, required: true, immutable: true, index: true },
    resourceType: { type: String, default: '', immutable: true, index: true },
    resourceId: { type: String, default: '', immutable: true },
    ip: { type: String, default: '', immutable: true },
    userAgent: { type: String, default: '', immutable: true },
    status: { type: String, enum: ['success', 'denied', 'failure'], default: 'success', immutable: true },
    summary: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

auditEventSchema.index({ timestamp: -1, action: 1 });
auditEventSchema.index({ 'actor.id': 1, timestamp: -1 });

// Append-only protection: prevent updates or deletes on audit trail
const rejectMutation = function rejectAuditMutation(next) {
  next(new Error('AuditEvent is append-only and cannot be modified or deleted'));
};

auditEventSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'],
  rejectMutation
);

export default mongoose.model('AuditEvent', auditEventSchema);
