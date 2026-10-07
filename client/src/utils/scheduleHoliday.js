// 排班頁日期標頭用的假日判斷。
// 規則對應 server/src/services/laborRuleValidationService.js 的 isCountedHoliday：
// 只有「國定假日 / 假日」類紀錄算假日，補班日、工作日不算。
// 另外，行事曆裡的「例假日」「公司休息日」是公司自訂的週休紀錄，不是國定假日，標頭不標示。

const NOT_A_HOLIDAY_TYPES = new Set(['例假日', '公司休息日'])

// 舊版「一鍵載入國定假日」把每個週末都存成「國定假日」（說明為空、來源 roc-calendar）：不是真的假日。
// 沒有來源或人工新增的資料一律當成真的假日。
function isEmptyWeekendHoliday(holiday) {
  if (String(holiday.source ?? '').trim() !== 'roc-calendar') return false
  const date = new Date(holiday.date)
  if (Number.isNaN(date.getTime())) return false
  const weekday = date.getUTCDay()
  if (weekday !== 0 && weekday !== 6) return false
  return !String(holiday.description ?? '').trim() && !String(holiday.desc ?? '').trim()
}

export function isCountedHoliday(holiday) {
  if (!holiday || typeof holiday !== 'object') return false
  if (isEmptyWeekendHoliday(holiday)) return false
  // 假日資料的 type 預設值是「國定假日」（server Holiday model），沒有 type 的舊資料照此處理
  const type = String(holiday.type || '').trim() || '國定假日'
  if (NOT_A_HOLIDAY_TYPES.has(type)) return false
  const text = [type, holiday.name, holiday.description, holiday.desc]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/工作日|補班|makeup\s*work/.test(text)) return false
  return /國定|假日|holiday/.test(text)
}

/** 標頭要顯示的假日名稱 */
export function getHolidayDisplayName(holiday) {
  return String(holiday?.name || holiday?.description || holiday?.desc || '').trim()
}
