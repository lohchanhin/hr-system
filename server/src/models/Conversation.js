import mongoose from 'mongoose';

const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    externalId: { type: String, required: true },
    recipientId: { type: String, required: true },
    integration: { type: Schema.Types.ObjectId, ref: 'InstagramIntegration', required: true },
    lastRepliedAt: { type: Date },
  },
  { timestamps: true }
);

conversationSchema.index({ tenantId: 1, externalId: 1 }, { unique: true });

export default mongoose.model('Conversation', conversationSchema);
