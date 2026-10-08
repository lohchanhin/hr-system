import mongoose from 'mongoose'
const { Schema } = mongoose

// 簽核附件的上傳紀錄：檔案只能被「上傳者本人」掛到「一張」簽核單。
// 上傳時 request 為空；建立（或重新送出）簽核單時才認領，之後下載會核對 request。
const approvalAttachmentSchema = new Schema(
  {
    filename: { type: String, required: true, unique: true },       // 磁碟上的檔名（時間戳-隨機碼.副檔名）
    uploader: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    original_name: String,
    size: Number,
    mime: String,
    request: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', default: null },
  },
  { timestamps: true }
)

approvalAttachmentSchema.index({ request: 1 })

export default mongoose.model('ApprovalAttachment', approvalAttachmentSchema)
