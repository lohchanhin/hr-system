// 系統預設表單的分類：以前預設寫的是「人事」，但表單分類清單（其他控制設定 → 表單分類）只有
// 人事類／總務類／請假類／其他，預設表單在畫面上歸不到任何分類。新的預設（services/defaultApprovalTemplates.js）
// 是「請假類」（請假）與「人事類」（其餘）。
// 啟動時（index.js）把「還是舊預設值『人事』的系統預設表單」改成新的預設分類，只做這一個已知的改名：
// - 只改 default_key 是預設表單的（或沒有 default_key、名稱與預設表單相同的舊資料），而且分類剛好是「人事」
// - 管理員自己建了「人事」這個分類（代碼或名稱）時完全不動：那是管理員的選擇
// - 已經改過的不會再改（冪等）；只記錄筆數
import FormTemplate from '../models/form_template.js'
// 整個模組匯入：單元測試常把設定 store 換成只有一兩個函式的替身
import * as settingsStore from './otherControlSettingsStore.js'
import { DEFAULT_APPROVAL_TEMPLATES } from './defaultApprovalTemplates.js'

export const LEGACY_DEFAULT_CATEGORY = '人事'

export async function alignLegacyDefaultFormCategories() {
  const settings = typeof settingsStore.getSettings === 'function' ? await settingsStore.getSettings() : null
  const categories = Array.isArray(settings?.formCategories) ? settings.formCategories : []
  if (categories.some((category) => category?.code === LEGACY_DEFAULT_CATEGORY || category?.name === LEGACY_DEFAULT_CATEGORY)) {
    return { updated: 0, skipped: 'admin-category' }
  }
  let updated = 0
  for (const def of DEFAULT_APPROVAL_TEMPLATES) {
    if (!def.category || def.category === LEGACY_DEFAULT_CATEGORY) continue
    const result = await FormTemplate.updateMany(
      {
        category: LEGACY_DEFAULT_CATEGORY,
        $or: [{ default_key: def.key }, { default_key: { $in: [null, ''] }, name: def.name }],
      },
      { $set: { category: def.category } },
      { timestamps: false },
    )
    updated += result?.modifiedCount ?? 0
  }
  return { updated }
}

export default { alignLegacyDefaultFormCategories, LEGACY_DEFAULT_CATEGORY }
