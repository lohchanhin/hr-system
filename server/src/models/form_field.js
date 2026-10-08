import mongoose from 'mongoose'
const { Schema } = mongoose

const formFieldSchema = new Schema(
  {
    form: { type: Schema.Types.ObjectId, ref: 'FormTemplate', required: true, index: true },
    label: { type: String, required: true },                    // 顯示標籤
    type_1: {                                                   // 基本型別
      type: String,
      enum: ['text','textarea','date','time','datetime','select','file','checkbox','number','signature','user','department','org'],
      required: true,
    },
    type_2: { type: String },                                   // 特殊型（如：單位內人員名單）
    required: { type: Boolean, default: false },
    options: { type: Schema.Types.Mixed },                      // 下拉/複選用（JSON）；連結字典時只是備援快照
    // 連結的字典代碼（如 C12）：有值且字典存在時，選項即時取自「其他控制設定」的字典項目；
    // 空字串代表管理員明確選擇「手動輸入」，不再依標籤自動連結；未設定（舊資料）才會依標籤尾端的 (Cxx) 自動連結
    field_key: { type: String, trim: true, maxlength: 40 },
    placeholder: String,
    order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

formFieldSchema.index({ form: 1, order: 1 })

export default mongoose.model('FormField', formFieldSchema)
