import mongoose from 'mongoose';

const instagramIntegrationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true, index: true },
    pageId: { type: String, required: true },
    instagramBusinessAccountId: { type: String },
    metaAccessToken: { type: String, required: true },
    tokenExpiresAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('InstagramIntegration', instagramIntegrationSchema);
