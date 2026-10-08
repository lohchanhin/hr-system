// 系統預設的簽核表單（「補齊預設值」與 ensure-leave-form 共用）。
// key 是固定代號：存在表單的 default_key，改名後仍能認出是哪一張預設表單；
// semanticType 明確寫出，不再靠名稱推論（名稱可以被客戶改掉）。

export const DEFAULT_POLICY = Object.freeze({
  maxApprovalLevel: 5,
  allowDelegate: false,
  overdueDays: 3,
  overdueAction: 'none',
})

export const DEFAULT_APPROVAL_TEMPLATES = [
  {
    key: 'leave',
    name: '請假',
    category: '人事',
    semanticType: 'leave',
    description: '用於申請各類假別（事假、病假、特休等），此表單會自動連接薪資系統計算扣薪或假勤。支援小時級別的精確請假時間。',
    fields: [
      { label: '假別', type_1: 'text', required: true, order: 1, placeholder: '例如：事假、病假、特休、婚假等' },
      { label: '開始時間', type_1: 'datetime', required: true, order: 2 },
      { label: '結束時間', type_1: 'datetime', required: true, order: 3 },
      { label: '事由', type_1: 'textarea', order: 4, placeholder: '請說明請假原因' },
      { label: '相關證明', type_1: 'file', required: true, order: 5 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'support',
    name: '支援申請',
    category: '人事',
    semanticType: 'general',
    description: '用於申請跨部門或單位支援，需經過相關單位主管與人資審核。',
    fields: [
      { label: '申請事由', type_1: 'textarea', required: true, order: 1 },
      { label: '開始日期', type_1: 'date', required: true, order: 2 },
      { label: '結束日期', type_1: 'date', required: true, order: 3 },
      { label: '附件', type_1: 'file', order: 4 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '支援單位主管' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'leave_carryover',
    name: '特休保留',
    category: '人事',
    semanticType: 'general',
    description: '用於申請保留當年度未使用的特別休假至次年度，需說明保留原因。',
    fields: [
      { label: '年度', type_1: 'text', required: true, order: 1 },
      { label: '保留天數', type_1: 'number', required: true, order: 2 },
      { label: '理由', type_1: 'textarea', order: 3 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'employment_certificate',
    name: '在職證明',
    category: '人事',
    semanticType: 'general',
    description: '用於申請在職證明文件，需說明使用目的（如：信貸、簽證等）。',
    fields: [
      { label: '用途', type_1: 'text', required: true, order: 1 },
      { label: '開立日期', type_1: 'date', required: true, order: 2 },
    ],
    steps: [
      { step_order: 1, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'resignation_certificate',
    name: '離職證明',
    category: '人事',
    semanticType: 'general',
    description: '用於申請離職證明文件，需確認離職日期並說明使用目的。',
    fields: [
      { label: '用途', type_1: 'text', order: 1 },
      { label: '離職日期', type_1: 'date', required: true, order: 2 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'overtime',
    name: '加班申請',
    category: '人事',
    semanticType: 'overtime',
    description: '用於申請加班時數，此表單會自動連接薪資系統計算加班費。支援小時級別的精確加班時間。',
    fields: [
      { label: '開始時間', type_1: 'datetime', required: true, order: 1 },
      { label: '結束時間', type_1: 'datetime', required: true, order: 2 },
      { label: '是否跨日', type_1: 'checkbox', required: true, order: 3 },
      { label: '事由', type_1: 'textarea', order: 4 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '排班負責人' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'punch_correction',
    name: '補簽申請',
    category: '人事',
    semanticType: 'general',
    description: '用於申請補打卡或補簽到退，需說明原因。此表單會影響考勤記錄。',
    fields: [
      { label: '開始時間', type_1: 'datetime', required: true, order: 1 },
      { label: '結束時間', type_1: 'datetime', required: true, order: 2 },
      { label: '是否跨日', type_1: 'checkbox', required: true, order: 3 },
      { label: '事由', type_1: 'textarea', order: 4 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  {
    key: 'bonus',
    name: '獎金申請',
    category: '人事',
    semanticType: 'general',
    description: '用於申請額外獎金或績效獎金，此表單會自動連接薪資系統計算獎金發放。需經財務與人資審核。',
    fields: [
      { label: '獎金類型', type_1: 'text', required: true, order: 1 },
      { label: '金額', type_1: 'number', required: true, order: 2 },
      { label: '事由', type_1: 'textarea', order: 3 },
    ],
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '財務覆核' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
]

export function findDefaultTemplate(key) {
  return DEFAULT_APPROVAL_TEMPLATES.find((template) => template.key === key) || null
}

export default { DEFAULT_APPROVAL_TEMPLATES, DEFAULT_POLICY, findDefaultTemplate }
