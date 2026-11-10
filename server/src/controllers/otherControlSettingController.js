import { createHash, randomUUID } from 'crypto'
import {
  getSettings,
  updateSettings,
  resetSettings
} from '../services/otherControlSettingsStore.js'

// 所有設定（字典項目、自訂欄位、表單分類、通知／資安／整合設定、自動化規則）都存在資料庫，
// 預設值與合併邏輯集中在 services/otherControlSettingsStore.js。

const READ_FAILED_MESSAGE = '無法讀取其他控制設定，請稍後再試'
const WRITE_FAILED_MESSAGE = '無法儲存其他控制設定，請稍後再試'

// 在 updateSettings 的 mutator 內丟出，代表請求本身有問題（找不到、重複、不可刪除），不會寫入資料庫
class SettingsRequestError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

function sendFailure(res, error, fallbackMessage) {
  if (error instanceof SettingsRequestError) {
    return res.status(error.status).json({ error: error.message, ...error.extra })
  }
  // 只記錄錯誤名稱：資料庫錯誤訊息可能帶連線資訊，設定內容也含 webhookUrl 與資安欄位，都不寫進 log
  console.error('[otherControlSetting] request failed:', error?.name ?? 'Error')
  return res.status(500).json({ error: fallbackMessage })
}

/*
 * 自訂欄位清單的版本：內容的雜湊（不另外存）。只要清單內容變了版本就不同，改別的設定（通知、字典…）不影響。
 * GET /api/other-control-settings 的 X-Custom-Fields-Version 標頭是目前的版本，PUT /custom-fields 可帶 version：
 * 和目前的版本不同（別人剛存過）回 409，不覆蓋別人的修改。沒有帶 version 的舊畫面照舊整份取代。
 * 版本只放在標頭（兩個回應的本體形狀都不變；PUT 成功的標頭是存完後的新版本）。
 */
export function customFieldsVersion(customFields) {
  return createHash('sha256').update(JSON.stringify(Array.isArray(customFields) ? customFields : [])).digest('hex').slice(0, 16)
}

function setCustomFieldsVersionHeader(res, version) {
  if (typeof res.set === 'function') res.set('X-Custom-Fields-Version', version)
}

export async function getOtherControlSettings(req, res) {
  try {
    const settings = await getSettings()
    const version = customFieldsVersion(settings.customFields)
    setCustomFieldsVersionHeader(res, version)
    res.json(settings)
  } catch (error) {
    sendFailure(res, error, READ_FAILED_MESSAGE)
  }
}

export async function updateNotificationSettings(req, res) {
  try {
    const payload = req.body || {}
    const settings = await updateSettings((current) => {
      current.notification = {
        ...current.notification,
        ...payload
      }
    })
    res.json(settings.notification)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function updateSecuritySettings(req, res) {
  try {
    const payload = req.body || {}
    const settings = await updateSettings((current) => {
      const ipWhitelist = Array.isArray(payload.ipWhitelist)
        ? payload.ipWhitelist
        : current.security.ipWhitelist

      current.security = {
        ...current.security,
        ...payload,
        ipWhitelist
      }
    })
    res.json(settings.security)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function updateIntegrationSettings(req, res) {
  try {
    const payload = req.body || {}
    const settings = await updateSettings((current) => {
      current.integration = {
        ...current.integration,
        ...payload
      }
    })
    res.json(settings.integration)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function getItemSettings(req, res) {
  try {
    const settings = await getSettings()
    res.json(settings.itemSettings)
  } catch (error) {
    sendFailure(res, error, READ_FAILED_MESSAGE)
  }
}

export async function updateItemSettings(req, res) {
  const payload = req.body

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'itemSettings 必須為物件' })
  }

  const invalidEntry = Object.entries(payload).find(([, value]) => !Array.isArray(value))

  if (invalidEntry) {
    const [key] = invalidEntry
    return res.status(400).json({ error: `itemSettings.${key} 必須為陣列` })
  }

  try {
    // 只取代有送來的字典陣列，其餘字典維持原樣
    const settings = await updateSettings((current) => {
      current.itemSettings = {
        ...current.itemSettings,
        ...payload
      }
    })
    res.json(settings.itemSettings)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function replaceCustomFields(req, res) {
  const { customFields, version } = req.body || {}
  if (!Array.isArray(customFields)) {
    return res.status(400).json({ error: 'customFields 必須為陣列' })
  }
  const hasVersion = version !== undefined && version !== null && version !== ''
  if (hasVersion && typeof version !== 'string') {
    return res.status(400).json({ error: '自訂欄位的版本格式不正確，請重新整理後再試', code: 'INVALID_VERSION' })
  }

  try {
    const settings = await updateSettings((current) => {
      // 在 mutator 內比對：樂觀鎖重跑時比對的是重新讀到的最新內容
      const currentVersion = customFieldsVersion(current.customFields)
      if (hasVersion && version !== currentVersion) {
        throw new SettingsRequestError(409, '自訂欄位剛被其他人修改，請重新整理後再編輯（這次的修改沒有儲存）', {
          code: 'CUSTOM_FIELDS_CONFLICT',
          currentVersion,
        })
      }
      current.customFields = customFields
    })
    setCustomFieldsVersionHeader(res, customFieldsVersion(settings.customFields))
    res.json(settings.customFields)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function listFormCategories(req, res) {
  try {
    const settings = await getSettings()
    res.json(settings.formCategories)
  } catch (error) {
    sendFailure(res, error, READ_FAILED_MESSAGE)
  }
}

export async function createFormCategory(req, res) {
  const payload = req.body || {}
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  const code = typeof payload.code === 'string' ? payload.code.trim() : name
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''

  if (!name) {
    return res.status(400).json({ error: '請輸入分類名稱', code: 'CATEGORY_NAME_REQUIRED' })
  }
  if (!code) {
    return res.status(400).json({ error: '請輸入識別碼', code: 'CATEGORY_CODE_REQUIRED' })
  }

  // id 在 mutator 外產生：樂觀鎖衝突而重跑 mutator 時，同一個請求仍是同一個 id
  const newCategory = {
    id: randomUUID(),
    name,
    code,
    description,
    builtin: false
  }

  try {
    await updateSettings((current) => {
      if (current.formCategories.some((category) => category.code === code)) {
        throw new SettingsRequestError(409, `識別碼「${code}」已經被其他分類使用，請換一個`, { code: 'CATEGORY_CODE_TAKEN' })
      }
      current.formCategories = [...current.formCategories, newCategory]
    })
    res.status(201).json(newCategory)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function updateFormCategory(req, res) {
  const { id } = req.params || {}
  const payload = req.body || {}

  try {
    let updatedCategory = null
    await updateSettings((current) => {
      const index = current.formCategories.findIndex((category) => category.id === id)
      if (index === -1) {
        throw new SettingsRequestError(404, '找不到指定分類')
      }

      const existing = current.formCategories[index]
      const name = typeof payload.name === 'string' ? payload.name.trim() : existing.name
      const code = typeof payload.code === 'string' ? payload.code.trim() : existing.code
      const description =
        typeof payload.description === 'string' ? payload.description.trim() : existing.description

      if (!name) {
        throw new SettingsRequestError(400, '請輸入分類名稱', { code: 'CATEGORY_NAME_REQUIRED' })
      }
      if (!code) {
        throw new SettingsRequestError(400, '請輸入識別碼', { code: 'CATEGORY_CODE_REQUIRED' })
      }
      if (current.formCategories.some((category) => category.id !== id && category.code === code)) {
        throw new SettingsRequestError(409, `識別碼「${code}」已經被其他分類使用，請換一個`, { code: 'CATEGORY_CODE_TAKEN' })
      }

      updatedCategory = {
        ...existing,
        name,
        code,
        description
      }
      current.formCategories[index] = updatedCategory
    })
    res.json(updatedCategory)
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export async function deleteFormCategory(req, res) {
  const { id } = req.params || {}

  try {
    await updateSettings((current) => {
      const index = current.formCategories.findIndex((category) => category.id === id)
      if (index === -1) {
        throw new SettingsRequestError(404, '找不到指定分類')
      }
      if (current.formCategories[index].builtin) {
        throw new SettingsRequestError(400, '內建分類無法刪除')
      }
      current.formCategories.splice(index, 1)
    })
    res.json({ success: true })
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

// 清掉資料庫內的設定，回到預設值（僅供測試與維護使用，沒有對外路由）
export async function resetOtherControlSettings() {
  await resetSettings()
}
