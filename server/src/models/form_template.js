import mongoose from 'mongoose'
const { Schema } = mongoose

const formTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 }, // 表單名稱（前後空白會去掉，空白名稱視為沒填）
    category: { type: String, default: '其他' },            // 類別：人事類/總務類/請假類/其他...
    semanticType: {
      type: String,
      enum: ['leave', 'overtime', 'shift_change', 'business_trip', 'general'],
      default: 'general',
      index: true,
    },
    // 表單性質是否已被明確寫入（建立 / 編輯時由管理者選擇或系統依名稱推論後寫入）。
    // 啟動時的舊資料補正只處理還沒寫過的舊表單，所以管理者特地改成「一般」的表單不會在重啟後被改回去。
    semantic_type_set: { type: Boolean, default: false },
    // 系統預設表單的固定代號（leave、overtime…）：改名後「補齊預設值」仍認得是哪一張，不會再建一張重複的
    default_key: { type: String, trim: true },
    description: String,
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
    owner_org_id: { type: String },                         // 可放機構代碼/ID
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

formTemplateSchema.index({ name: 1, owner_org_id: 1 }, { unique: true, sparse: true })

export default mongoose.model('FormTemplate', formTemplateSchema)
