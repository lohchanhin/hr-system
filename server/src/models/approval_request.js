import mongoose from 'mongoose'
const { Schema } = mongoose

// decision：pending 尚未處理；approved/rejected/returned 是本人的決議；
// skipped 代表「這關已由其他簽核人（或管理員）處理完成，本人免簽」，不是本人簽的。
// 舊資料在「任一人同意」的關卡把沒簽的人記成 approved（沒有 decided_at），讀取端要能容忍。
const decisionSchema = new Schema(
  {
    approver: { type: Schema.Types.ObjectId, ref: 'Employee' },     // 審核人（以 Employee 為主）
    decision: { type: String, enum: ['pending','approved','rejected','returned','skipped'], default: 'pending' },
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
    action: String,                                                // create/approve/reject/return/move_next/skip/finish/admin_override...
    message: String,
    comment: String,                                               // 簽核人填的意見原文（退簽原因等）
    step_order: Number,                                            // 動作發生在第幾關（1 起算）
    decision: String,                                              // 管理員代為處理時的決議：approve/reject/return
  },
  { _id: false }
)

// 特休扣減／返還的結果；失敗時由人資看這裡補登，不再只是一行沒人看得到的 log
const annualLeaveSchema = new Schema(
  {
    days: Number,
    state: { type: String, enum: ['deducted', 'failed', 'refunded'] },
    message: String,
    at: Date,
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
    idempotency_key: { type: String, trim: true, maxlength: 128 },

    status: { type: String, enum: ['pending','approved','rejected','returned','canceled'], default: 'pending' },
    current_step_index: { type: Number, default: 0 },               // 0-based
    steps: { type: [requestStepSchema], default: [] },
    logs: { type: [logSchema], default: [] },
    annual_leave: { type: annualLeaveSchema, default: undefined },
  },
  { timestamps: true, optimisticConcurrency: true }
)

approvalRequestSchema.index({ status: 1, 'steps.approvers.approver': 1 })
approvalRequestSchema.index({ 'steps.approvers.approver': 1, updatedAt: -1 })
approvalRequestSchema.index({ applicant_employee: 1, createdAt: -1 })
approvalRequestSchema.index({ status: 1, updatedAt: -1 })
approvalRequestSchema.index({ updatedAt: -1 })
approvalRequestSchema.index(
  { applicant_employee: 1, idempotency_key: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotency_key: { $type: 'string' } },
  },
)

export default mongoose.model('ApprovalRequest', approvalRequestSchema)
