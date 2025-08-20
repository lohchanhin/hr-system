import mongoose from 'mongoose'
const { Schema } = mongoose

const decisionSchema = new Schema(
  {
    approver: { type: Schema.Types.ObjectId, ref: 'Employee' },     // 審核人（以 Employee 為主）
    decision: { type: String, enum: ['pending','approved','rejected','returned'], default: 'pending' },
    comment: String,
    decided_at: Date,
  },
  { _id: false }
)

const requestStepSchema = new Schema(
  {
    step_order: Number,
    approvers: { type: [decisionSchema], default: [] },             // 此關所有審核人
    all_must_approve: { type: Boolean, default: true },
    is_required: { type: Boolean, default: true },
    can_return: { type: Boolean, default: true },
    started_at: Date,
    finished_at: Date,
  },
  { _id: false }
)

const logSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by_user: { type: Schema.Types.ObjectId, ref: 'User' },
    by_employee: { type: Schema.Types.ObjectId, ref: 'Employee' },
    action: String,                                                // create/approve/reject/return/move_next/finish...
    message: String,
  },
  { _id: false }
)

const approvalRequestSchema = new Schema(
  {
    form: { type: Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
    workflow: { type: Schema.Types.ObjectId, ref: 'ApprovalWorkflow', required: true },
    form_data: { type: Schema.Types.Mixed, default: {} },           // 依欄位設定動態存
    applicant_user: { type: Schema.Types.ObjectId, ref: 'User' },
    applicant_employee: { type: Schema.Types.ObjectId, ref: 'Employee' },
    applicant_org: String,
    applicant_department: String,

    status: { type: String, enum: ['pending','approved','rejected','returned','canceled'], default: 'pending' },
    current_step_index: { type: Number, default: 0 },               // 0-based
    steps: { type: [requestStepSchema], default: [] },
    logs: { type: [logSchema], default: [] },
  },
  { timestamps: true }
)

approvalRequestSchema.index({ status: 1, 'steps.approvers.approver': 1 })
approvalRequestSchema.index({ applicant_employee: 1, createdAt: -1 })

export default mongoose.model('ApprovalRequest', approvalRequestSchema)
