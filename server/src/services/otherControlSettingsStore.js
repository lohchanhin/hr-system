import OtherControlSetting from '../models/OtherControlSetting.js'

// 其他控制設定的持久化層：整份設定存成 OtherControlSetting 集合中的單一文件（key: 'default'）。
// 字典項目（itemSettings）、自訂欄位、表單分類等都由這裡讀寫，伺服器重啟後不會回到預設值。

const SETTINGS_KEY = 'default'
const MAX_WRITE_ATTEMPTS = 8

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

const DEFAULT_SETTINGS = {
  ...defaultSettings,
  formCategories: defaultFormCategories
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/** 取得一份全新的預設設定（每次呼叫都是獨立複本，可安全修改）。 */
export function getDefaultSettings() {
  return toPlainJson(DEFAULT_SETTINGS)
}

// 內建分類無法刪除，所以預設的內建分類若不在資料庫文件裡（例如日後新增內建分類），補回最前面
function withBuiltinCategories(categories, defaultCategories) {
  const existingIds = new Set(categories.map((category) => category?.id))
  const missing = defaultCategories.filter((category) => !existingIds.has(category.id))
  return missing.length ? [...missing, ...categories] : categories
}

/**
 * 把資料庫內的設定疊在預設值之上：
 * - 物件型區塊（notification / security / integration / itemSettings）逐欄位合併，已存的值優先、日後新增的預設欄位會自動出現；
 *   itemSettings 的每個字典陣列整份以已存的為準（更新時只取代有送來的字典，與舊行為一致）。
 * - 陣列型區塊（customFields / automationRules / formCategories）已存的整份優先；內建分類缺少時會補回。
 * - 已存的型別不符時（資料損毀）退回預設值，不讓畫面壞掉。
 */
export function mergeWithDefaults(stored) {
  const defaults = getDefaultSettings()
  const source = isPlainObject(stored) ? stored : {}
  const merged = {}

  for (const key of Object.keys(defaults)) {
    const fallback = defaults[key]
    const value = source[key]
    if (isPlainObject(fallback)) {
      merged[key] = isPlainObject(value) ? { ...fallback, ...value } : fallback
    } else if (Array.isArray(fallback)) {
      merged[key] = Array.isArray(value) ? value : fallback
    } else {
      merged[key] = value === undefined || value === null ? fallback : value
    }
  }

  // 資料庫內多出來的區塊（較新版本寫入的欄位）原樣保留
  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || hasOwn(merged, key)) continue
    merged[key] = value
  }

  merged.formCategories = withBuiltinCategories(merged.formCategories, defaults.formCategories)
  return merged
}

async function loadDocument() {
  const document = await OtherControlSetting.findOne({ key: SETTINGS_KEY }).lean()
  return document ?? null
}

let indexReady = null

// 第一次建立文件前先等 unique index 建好，避免同時建立出兩份文件
function ensureIndexReady() {
  if (!indexReady) {
    indexReady =
      typeof OtherControlSetting.init === 'function'
        ? Promise.resolve(OtherControlSetting.init()).catch(() => {})
        : Promise.resolve()
  }
  return indexReady
}

// 回傳 true 代表這次寫入成功；false 代表別的請求同時改了設定，需重新讀取後再試
async function persist(document, data) {
  if (!document) {
    await ensureIndexReady()
    try {
      // upsert + $setOnInsert：同時有多個請求第一次建立時，只會有一個真的插入（previous 為 null）
      const previous = await OtherControlSetting.findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { data, revision: 1 } },
        { upsert: true, new: false }
      ).lean()
      return previous === null
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  }

  const revision = typeof document.revision === 'number' ? document.revision : { $in: [null] }
  const updated = await OtherControlSetting.findOneAndUpdate(
    { key: SETTINGS_KEY, revision },
    { $set: { data }, $inc: { revision: 1 } },
    { new: true }
  ).lean()
  return Boolean(updated)
}

/** 取得完整設定（預設值 + 資料庫內已存的值，已存的優先）。每次都是獨立複本。 */
export async function getSettings() {
  const document = await loadDocument()
  return mergeWithDefaults(document?.data)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function applyUpdate(mutator) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // 別的程序同時在改：稍微錯開再重試，避免大家同時重新讀取又互撞
      await wait(5 + Math.floor(Math.random() * 10 * attempt))
    }
    const document = await loadDocument()
    const settings = mergeWithDefaults(document?.data)
    await mutator(settings)
    const next = mergeWithDefaults(toPlainJson(settings))
    if (await persist(document, next)) {
      return next
    }
  }

  throw new Error('其他控制設定同時被多次修改，請稍後再試')
}

// 同一個程序內的更新排隊執行，不會彼此衝突；不同程序（例如 PM2 多個 worker）之間則靠 revision 樂觀鎖
let updateQueue = Promise.resolve()

/**
 * 讀取 → 交給 mutator 修改 → 寫回資料庫，回傳修改後的完整設定。
 * mutator 可為同步或非同步，直接修改傳入的設定物件（回傳值會被忽略）；
 * mutator 丟出錯誤時不會寫入，錯誤原樣往外丟。
 * 以 revision 做樂觀鎖：寫入時若別的程序已先改過，會重新讀取並再執行一次 mutator，所以 mutator 必須可重複執行。
 */
export function updateSettings(mutator) {
  if (typeof mutator !== 'function') {
    return Promise.reject(new TypeError('updateSettings 需要傳入 mutator 函式'))
  }
  const run = updateQueue.then(() => applyUpdate(mutator))
  updateQueue = run.catch(() => {})
  return run
}

/** 清掉資料庫內的設定文件，之後讀取會回到預設值（供測試與維護使用，沒有對外路由）。 */
export async function resetSettings() {
  await OtherControlSetting.deleteOne({ key: SETTINGS_KEY })
}

function pickText(source, keys) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function normalizeDictionaryItem(item) {
  if (typeof item === 'string') {
    const text = item.trim()
    return text ? { name: text, code: text } : null
  }
  if (typeof item === 'number' && Number.isFinite(item)) {
    const text = String(item)
    return { name: text, code: text }
  }
  if (!isPlainObject(item)) return null

  const code = pickText(item, ['code', 'value', 'key', 'id'])
  const name = pickText(item, ['name', 'label', 'text']) || code
  if (!name) return null
  return { name, code: code || name }
}

/** 把字典陣列正規化成 [{ name, code }]：字串與物件都接受，略過空白項目，同名只留第一筆。 */
export function normalizeDictionaryItems(items) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const result = []
  for (const item of items) {
    const normalized = normalizeDictionaryItem(item)
    if (!normalized || seen.has(normalized.name)) continue
    seen.add(normalized.name)
    result.push(normalized)
  }
  return result
}

/** 取得指定字典（例如 C12）目前的項目，格式為 [{ name, code }]；字典不存在或沒有項目時回傳空陣列。 */
export async function getDictionaryItems(key) {
  const dictionaryKey = typeof key === 'string' ? key.trim() : ''
  if (!dictionaryKey) return []
  const { itemSettings } = await getSettings()
  if (!hasOwn(itemSettings, dictionaryKey)) return []
  return normalizeDictionaryItems(itemSettings[dictionaryKey])
}

/** 取得可作為選項來源的字典代碼（itemSettings 內值為陣列的所有 key），供欄位連結時驗證。 */
export async function getDictionaryDefinitions() {
  const { itemSettings } = await getSettings()
  return Object.keys(itemSettings).filter((key) => Array.isArray(itemSettings[key]))
}
