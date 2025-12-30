import { randomUUID } from 'crypto'

const defaultSettings = {
  notification: {
    enableEmail: true,
    enableSMS: false,
    defaultReminderMinutes: 30,
    digestTime: '08:30',
    escalationTargets: ['manager'],
    frequency: 'immediate'
  },
  security: {
    enforce2FA: true,
    passwordExpiration: true,
    passwordExpireDays: 90,
    sessionTimeout: 30,
    loginAlert: true,
    maintenanceContacts: ['security'],
    ipWhitelist: [
      { label: '台北總部', address: '203.0.113.0/24' },
      { label: '備援機房', address: '198.51.100.25' }
    ]
  },
  customFields: [
    {
      label: '員工證字號',
      fieldKey: 'nationalId',
      type: 'text',
      category: 'employee',
      group: '基本資料',
      required: true,
      description: '供報稅與投保使用'
    },
    {
      label: '制服尺寸',
      fieldKey: 'uniformSize',
      type: 'select',
      category: 'employee',
      group: '報到資訊',
      required: false,
      description: '入職前通知行政備貨'
    },
    {
      label: '職稱選單 (C03)',
      fieldKey: 'C03',
      type: 'select',
      category: 'dictionary',
      group: '職務設定',
      required: true,
      description: '維護員工職稱清單'
    },
    {
      label: '執業職稱選單 (C04)',
      fieldKey: 'C04',
      type: 'select',
      category: 'dictionary',
      group: '職務設定',
      required: false,
      description: '提供專業人員執業職稱選項'
    },
    {
      label: '語言能力庫 (C05)',
      fieldKey: 'C05',
      type: 'composite',
      category: 'dictionary',
      group: '基本資料',
      required: false,
      description: '設定可勾選的語言能力與層級'
    },
    {
      label: '身障等級 (C06)',
      fieldKey: 'C06',
      type: 'select',
      category: 'dictionary',
      group: '基本資料',
      required: false,
      description: '維護身心障礙手冊等級'
    },
    {
      label: '身分類別 (C07)',
      fieldKey: 'C07',
      type: 'select',
      category: 'dictionary',
      group: '基本資料',
      required: false,
      description: '設定身份註記分類'
    },
    {
      label: '教育程度 (C08)',
      fieldKey: 'C08',
      type: 'select',
      category: 'dictionary',
      group: '學歷資料',
      required: false,
      description: '維護教育程度選單'
    },
    {
      label: '緊急聯絡人稱謂 (C09)',
      fieldKey: 'C09',
      type: 'select',
      category: 'dictionary',
      group: '聯絡資訊',
      required: false,
      description: '提供緊急聯絡人稱謂選項'
    },
    {
      label: '教育訓練積分類別 (C10)',
      fieldKey: 'C10',
      type: 'select',
      category: 'dictionary',
      group: '教育訓練',
      required: false,
      description: '維護教育訓練積分類別'
    },
    {
      label: '假別類別 (C12)',
      fieldKey: 'C12',
      type: 'select',
      category: 'dictionary',
      group: '假別設定',
      required: true,
      description: '維護假別類別與對應設定'
    },
    {
      label: '津貼項目 (C14)',
      fieldKey: 'C14',
      type: 'select',
      category: 'dictionary',
      group: '薪資設定',
      required: false,
      description: '維護津貼或補貼項目'
    }
  ],
  itemSettings: {
    C03: ['助理', '專員', '經理'],
    C04: ['護理師', '藥師', '工程師'],
    C05: [
      { label: '英文', levels: ['A1', 'B2', 'C1'] },
      { label: '日文', levels: ['N3', 'N2', 'N1'] }
    ],
    C06: ['第一類', '第二類', '第三類'],
    C07: ['一般員工', '派遣', '實習'],
    C08: ['高中', '大學', '碩士', '博士'],
    C09: ['父親', '母親', '配偶', '其他'],
    C10: ['新進訓練', '專業課程', '領導力'],
    C12: ['特休假', '病假', '事假'],
    C14: ['交通補助', '餐費補助', '職務津貼']
  },
  integration: {
    vendor: 'none',
    syncSchedule: true,
    syncPayroll: false,
    webhookUrl: '',
    autoRetry: true,
    lastSync: '尚未同步',
    statusMessage: '等待測試'
  },
  automationRules: [
    {
      name: '新員工自動啟用',
      trigger: '建立員工主檔後',
      status: 'enabled',
      actions: ['assignDefaultRole', 'sendMail'],
      notifyTargets: ['hr'],
      description: '自動寄送歡迎信並指派 HR 夥伴'
    },
    {
      name: '異常登入鎖定',
      trigger: '帳號連續 5 次登入失敗',
      status: 'disabled',
      actions: ['lockAccount', 'sendMail'],
      notifyTargets: ['admin', 'security'],
      description: '通知系統管理員並暫停帳號'
    }
  ]
}

const defaultFormCategories = [
  {
    id: 'cat-personnel',
    name: '人事類',
    code: '人事類',
    description: '人員異動、到職與人事流程',
    builtin: true
  },
  {
    id: 'cat-general',
    name: '總務類',
    code: '總務類',
    description: '行政資產、採購與總務流程',
    builtin: true
  },
  {
    id: 'cat-leave',
    name: '請假類',
    code: '請假類',
    description: '各式請假、補休與出勤相關流程',
    builtin: true
  },
  {
    id: 'cat-other',
    name: '其他',
    code: '其他',
    description: '尚未分類或臨時需求流程',
    builtin: true
  }
]

function cloneSettings() {
  return JSON.parse(JSON.stringify(defaultSettings))
}

let otherControlSettings = cloneSettings()
let formCategories = defaultFormCategories.map((category) => ({ ...category }))

export function getOtherControlSettings(req, res) {
  res.json({
    ...otherControlSettings,
    formCategories
  })
}

export function updateNotificationSettings(req, res) {
  otherControlSettings.notification = {
    ...otherControlSettings.notification,
    ...(req.body || {})
  }
  res.json(otherControlSettings.notification)
}

export function updateSecuritySettings(req, res) {
  const payload = req.body || {}
  const ipWhitelist = Array.isArray(payload.ipWhitelist)
    ? payload.ipWhitelist
    : otherControlSettings.security.ipWhitelist

  otherControlSettings.security = {
    ...otherControlSettings.security,
    ...payload,
    ipWhitelist
  }

  res.json(otherControlSettings.security)
}

export function updateIntegrationSettings(req, res) {
  otherControlSettings.integration = {
    ...otherControlSettings.integration,
    ...(req.body || {})
  }
  res.json(otherControlSettings.integration)
}

export function getItemSettings(req, res) {
  res.json(otherControlSettings.itemSettings)
}

export function updateItemSettings(req, res) {
  const payload = req.body

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'itemSettings 必須為物件' })
  }

  const invalidEntry = Object.entries(payload).find(([, value]) => !Array.isArray(value))

  if (invalidEntry) {
    const [key] = invalidEntry
    return res.status(400).json({ error: `itemSettings.${key} 必須為陣列` })
  }

  otherControlSettings.itemSettings = {
    ...otherControlSettings.itemSettings,
    ...payload
  }

  res.json(otherControlSettings.itemSettings)
}

export function replaceCustomFields(req, res) {
  const { customFields } = req.body || {}
  if (!Array.isArray(customFields)) {
    return res.status(400).json({ error: 'customFields 必須為陣列' })
  }
  otherControlSettings.customFields = customFields
  res.json(otherControlSettings.customFields)
}

export function listFormCategories(req, res) {
  res.json(formCategories)
}

export function createFormCategory(req, res) {
  const payload = req.body || {}
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const code = typeof payload.code === 'string' ? payload.code.trim() : name
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''

  if (!name) {
    return res.status(400).json({ error: 'name 為必填欄位' })
  }
  if (!code) {
    return res.status(400).json({ error: 'code 為必填欄位' })
  }
  if (formCategories.some((category) => category.code === code)) {
    return res.status(409).json({ error: 'code 已存在' })
  }

  const newCategory = {
    id: randomUUID(),
    name,
    code,
    description,
    builtin: false
  }
  formCategories.push(newCategory)
  res.status(201).json(newCategory)
}

export function updateFormCategory(req, res) {
  const { id } = req.params || {}
  const index = formCategories.findIndex((category) => category.id === id)
  if (index === -1) {
    return res.status(404).json({ error: '找不到指定分類' })
  }

  const payload = req.body || {}
  const name = typeof payload.name === 'string' ? payload.name.trim() : formCategories[index].name
  const code = typeof payload.code === 'string' ? payload.code.trim() : formCategories[index].code
  const description =
    typeof payload.description === 'string'
      ? payload.description.trim()
      : formCategories[index].description

  if (!name) {
    return res.status(400).json({ error: 'name 為必填欄位' })
  }
  if (!code) {
    return res.status(400).json({ error: 'code 為必填欄位' })
  }
  if (formCategories.some((category) => category.id !== id && category.code === code)) {
    return res.status(409).json({ error: 'code 已存在' })
  }

  formCategories[index] = {
    ...formCategories[index],
    name,
    code,
    description
  }

  res.json(formCategories[index])
}

export function deleteFormCategory(req, res) {
  const { id } = req.params || {}
  const index = formCategories.findIndex((category) => category.id === id)
  if (index === -1) {
    return res.status(404).json({ error: '找不到指定分類' })
  }
  if (formCategories[index].builtin) {
    return res.status(400).json({ error: '內建分類無法刪除' })
  }
  formCategories.splice(index, 1)
  res.json({ success: true })
}

export function resetOtherControlSettings() {
  otherControlSettings = cloneSettings()
  formCategories = defaultFormCategories.map((category) => ({ ...category }))
}
