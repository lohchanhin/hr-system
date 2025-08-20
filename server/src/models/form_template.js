import mongoose from 'mongoose'
const { Schema } = mongoose

const formTemplateSchema = new Schema(
  {
    name: { type: String, required: true },                 // 表單名稱
    category: { type: String, default: '其他' },            // 類別：人事類/總務類/請假類/其他...
    description: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
    owner_org_id: { type: String },                         // 可放機構代碼/ID
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

formTemplateSchema.index({ name: 1, owner_org_id: 1 }, { unique: true, sparse: true })

export default mongoose.model('FormTemplate', formTemplateSchema)
