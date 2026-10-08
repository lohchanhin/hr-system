// 簽核標籤（Employee.signTags）的統一正規化。
// 員工儲存、批量匯入、流程關卡設定、簽核人解析都用同一套規則，
// 否則「人資 」「人資」「人資」（全形）會被當成不同標籤而永遠對不上。
//
// 規則：NFKC 正規化（全形轉半形）、去頭尾空白、內部連續空白壓成一個空格、
// 去掉空字串、去重（保留第一次出現的順序）。

const TAG_SEPARATOR_PATTERN = /[,，、;；\r\n]+/

/**
 * 正規化單一標籤，傳入非字串或結果為空時回傳 ''。
 */
export function normalizeSignTag(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/**
 * 正規化標籤清單：接受陣列或單一字串，回傳去空、去重後的陣列。
 * 字串不會被拆開（逗號分隔請先用 splitSignTagText）。
 */
export function normalizeSignTags(values) {
  if (values === null || values === undefined) return []
  const list = Array.isArray(values) ? values : [values]
  const seen = new Set()
  const result = []
  for (const item of list) {
    const tag = normalizeSignTag(item)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}

/**
 * 把「人資, 排班負責人、財務覆核」這種以逗號/頓號/分號/換行分隔的文字拆成標籤清單
 * （批量匯入的 簽核標籤 欄位使用）。
 */
export function splitSignTagText(text) {
  if (text === null || text === undefined) return []
  if (Array.isArray(text)) return normalizeSignTags(text)
  return normalizeSignTags(String(text).split(TAG_SEPARATOR_PATTERN))
}

export default { normalizeSignTag, normalizeSignTags, splitSignTagText }
