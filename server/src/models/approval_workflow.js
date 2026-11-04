import mongoose from 'mongoose'
const { Schema } = mongoose

// 關卡的適用條件（只有表單性質＝請假的表單可以設定，見 docs/approval-supervisor-chain.md）：
// 請假長度「大於或等於」value 才需要這一關，不到就整關不送（單據紀錄寫明「第N關不適用（…）」）。
// 沒有這個欄位（舊資料、沒有設定）＝每張單都要這一關，和以前一樣。
// （和 services/approverResolution.js 的 STEP_CONDITION_KINDS 相同；這裡不匯出，測試會把整個模型換成只有 default 的替身）
const STEP_CONDITION_KINDS = Object.freeze([
  'leave_hours_gte',          // 請假時數 ≥ value 小時
  'leave_calendar_days_gte',  // 請假期間的日曆日（台灣日期、含頭尾）≥ value 日
  'leave_scheduled_days_gte', // 請假期間排了工作班的日子 ≥ value 日（沒有班表的日子以日曆日計算）
])

const stepConditionSchema = new Schema(
  {
    kind: { type: String, enum: STEP_CONDITION_KINDS, required: true },
    value: { type: Number, required: true, min: 0.5, max: 2928 },
  },
  { _id: false }
)

const stepSchema = new Schema(
  {
    step_order: { type: Number, required: true }, // 第幾關（從 1 起跳）
    approver_type: {                               // 審核對象類型
      type: String,
      // manager_chain＝主管鏈：從申請人的直屬主管一路往上，每一級一關（approver_value 是 { stopAtTag, maxLevels }）
      enum: ['manager','manager_chain','tag','user','role','level','department','org','group'],
      required: true,
    },
    approver_value: { type: Schema.Types.Mixed },  // 例如 tag 名稱 / userId 陣列...
    scope_type: { type: String, enum: ['none','dept','org'], default: 'none' }, // 篩選持有標籤 / 角色 / 層級的人所屬的範圍（群組範圍沒有任何作用，不再提供）
    is_required: { type: Boolean, default: true }, // 必簽？
    all_must_approve: { type: Boolean, default: true }, // 必須全部核可？
    can_return: { type: Boolean, default: true },  // 允許退簽？
    name: { type: String, trim: true, maxlength: 50 }, // 關卡說明（可選）
    condition: { type: stepConditionSchema, default: undefined }, // 適用條件（可選，只有請假表單）
  },
  { _id: false }
)

const approvalWorkflowSchema = new Schema(
  {
    form: { type: Schema.Types.ObjectId, ref: 'FormTemplate', unique: true, required: true },
    steps: { type: [stepSchema], default: [] },
    // 通用規則（「通用流程規則」）：maxApprovalLevel、allowDelegate、overdueDays、overdueAction 目前只會被記錄，
    // 系統尚未依這些設定自動處理（不限制關卡數、沒有代理簽核、沒有逾時處理）。
    // skipRepeatedApprovers 會生效：已是前面關卡簽核人的人，後面的關卡不再重複簽（預設關閉＝和以前一樣；主管鏈關卡不論開關一律略過重複的人）
    policy: {
      maxApprovalLevel: { type: Number, default: 5, min: 1, max: 20 },
      allowDelegate: { type: Boolean, default: false },
      overdueDays: { type: Number, default: 3, min: 1, max: 365 },
      overdueAction: { type: String, enum: ['none','autoPass','autoReject'], default: 'none' },
      skipRepeatedApprovers: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
)

export default mongoose.model('ApprovalWorkflow', approvalWorkflowSchema)
