import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    tenantId: { type: String, required: true, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    body: { type: String, required: true },
    recipientId: { type: String, required: true },
    senderId: { type: String },
    externalMessageId: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);
