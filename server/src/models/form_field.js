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
    options: { type: Schema.Types.Mixed },                      // 下拉/複選用（JSON）
    placeholder: String,
    order: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

formFieldSchema.index({ form: 1, order: 1 })

export default mongoose.model('FormField', formFieldSchema)
