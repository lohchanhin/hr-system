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
      label: '班別名稱 (C11)',
      fieldKey: 'C11_name',
      type: 'text',
      category: 'dictionary',
      group: '班別設定',
      required: true,
      description: '顯示於班別選單的名稱'
    },
    {
      label: '班別說明 (C11)',
      fieldKey: 'C11_content',
      type: 'textarea',
      category: 'dictionary',
      group: '班別設定',
      required: false,
      description: '補充班別內容或注意事項'
    },
    {
      label: '班別時段 (C11)',
      fieldKey: 'C11_timeRange',
      type: 'timeRange',
      category: 'dictionary',
      group: '班別設定',
      required: true,
      description: '設定班別的起訖時間'
    },
    {
      label: '休息是否計薪 (C11)',
      fieldKey: 'C11_paidBreak',
      type: 'boolean',
      category: 'dictionary',
      group: '班別設定',
      required: false,
      description: '決定休息時間是否計薪'
    },
    {
      label: '允許彈性時間 (C11)',
      fieldKey: 'C11_allowFlexTime',
      type: 'boolean',
      category: 'dictionary',
      group: '班別設定',
      required: false,
      description: '是否允許彈性前後時間'
    },
    {
      label: '彈性區間分鐘數 (C11)',
      fieldKey: 'C11_flexWindow',
      type: 'number',
      category: 'dictionary',
      group: '班別設定',
      required: false,
      description: '可彈性調整的分鐘數'
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
      label: '加班原因 (C13)',
      fieldKey: 'C13',
      type: 'select',
      category: 'dictionary',
      group: '加班設定',
      required: false,
      description: '設定常用的加班原因'
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

function cloneSettings() {
  return JSON.parse(JSON.stringify(defaultSettings))
}

let otherControlSettings = cloneSettings()

export function getOtherControlSettings(req, res) {
  res.json(otherControlSettings)
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

export function replaceCustomFields(req, res) {
  const { customFields } = req.body || {}
  if (!Array.isArray(customFields)) {
    return res.status(400).json({ error: 'customFields 必須為陣列' })
  }
  otherControlSettings.customFields = customFields
  res.json(otherControlSettings.customFields)
}

export function resetOtherControlSettings() {
  otherControlSettings = cloneSettings()
}
