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
    scope_type: { type: String, enum: ['none','dept','org','group'], default: 'none' },
    is_required: { type: Boolean, default: true }, // 必簽？
    all_must_approve: { type: Boolean, default: true }, // 必須全部核可？
    can_return: { type: Boolean, default: true },  // 允許退簽？
    name: String,                                   // 關卡說明（可選）
  },
  { _id: false }
)

const approvalWorkflowSchema = new Schema(
  {
    form: { type: Schema.Types.ObjectId, ref: 'FormTemplate', unique: true, required: true },
    steps: { type: [stepSchema], default: [] },
    policy: {                                        // 通用規則（你的「通用流程規則」）
      maxApprovalLevel: { type: Number, default: 5 },
      allowDelegate: { type: Boolean, default: false },
      overdueDays: { type: Number, default: 3 },
      overdueAction: { type: String, enum: ['none','autoPass','autoReject'], default: 'none' },
    },
  },
  { timestamps: true }
)

export default mongoose.model('ApprovalWorkflow', approvalWorkflowSchema)
