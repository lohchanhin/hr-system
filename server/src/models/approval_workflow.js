import mongoose from 'mongoose'
const { Schema } = mongoose

const stepSchema = new Schema(
  {
    step_order: { type: Number, required: true }, // 第幾關（從 1 起跳）
    approver_type: {                               // 審核對象類型
      type: String,
      enum: ['manager','tag','user','role','level','department','org','group'],
      required: true,
    },
    approver_value: { type: Schema.Types.Mixed },  // 例如 tag 名稱 / userId 陣列...
    scope_type: { type: String, enum: ['none','dept','org'], default: 'none' }, // 篩選持有標籤 / 角色 / 層級的人所屬的範圍（群組範圍沒有任何作用，不再提供）
    is_required: { type: Boolean, default: true }, // 必簽？
    all_must_approve: { type: Boolean, default: true }, // 必須全部核可？
    can_return: { type: Boolean, default: true },  // 允許退簽？
    name: { type: String, trim: true, maxlength: 50 }, // 關卡說明（可選）
  },
  { _id: false }
)

const approvalWorkflowSchema = new Schema(
  {
    form: { type: Schema.Types.ObjectId, ref: 'FormTemplate', unique: true, required: true },
    steps: { type: [stepSchema], default: [] },
    // 通用規則（「通用流程規則」）：目前只會被記錄，系統尚未依這些設定自動處理（不限制關卡數、沒有代理簽核、沒有逾時處理）
    policy: {
      maxApprovalLevel: { type: Number, default: 5, min: 1, max: 20 },
      allowDelegate: { type: Boolean, default: false },
      overdueDays: { type: Number, default: 3, min: 1, max: 365 },
      overdueAction: { type: String, enum: ['none','autoPass','autoReject'], default: 'none' },
    },
  },
  { timestamps: true }
)

export default mongoose.model('ApprovalWorkflow', approvalWorkflowSchema)
