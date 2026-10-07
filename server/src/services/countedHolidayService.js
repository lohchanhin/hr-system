/**
 * 哪些 Holiday 文件算「要放假的國定假日」。
 * 純函式、不碰資料庫，方便加班費、排班檢查等不同地方共用同一套判斷。
 */

function utcDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function hasText(value) {
  return String(value ?? '').trim() !== '';
}

/**
 * 排班檢核、加班費、匯入提醒共用的國定假日判斷：
 * 工作日、補班日（makeup work）不算假日；類型/名稱/說明含「國定」「假日」或 holiday 才算。
 */
const NOT_A_HOLIDAY_TYPES = new Set(['例假日', '公司休息日']);

export function isCountedHoliday(holiday) {
  // 行事曆裡的「例假日」「公司休息日」是公司自訂的休息紀錄，不是國定假日
  if (NOT_A_HOLIDAY_TYPES.has(String(holiday?.type ?? '').trim())) return false;
  const text = [holiday?.type, holiday?.name, holiday?.description, holiday?.desc]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/工作日|補班|makeup\s*work/.test(text)) return false;
  return /國定|假日|holiday/.test(text);
}

/**
 * 舊版國定假日匯入會把每個週六、週日都寫成「國定假日」（上游資料的說明是空的）。
 * 週末又沒有任何說明，代表它只是一般週末，不是真的國定假日。
 */
export function isEmptyWeekendHoliday(holiday) {
  // 只有「國定假日一鍵匯入」產生的才算雜訊（它一定標記 source 為 roc-calendar）；
  // 人工新增（manual）或沒有來源的資料一律當成真的假日，不能誤判
  if (String(holiday?.source ?? '').trim() !== 'roc-calendar') return false;
  const date = new Date(holiday?.date);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getUTCDay();
  if (weekday !== 0 && weekday !== 6) return false;
  return !hasText(holiday?.description) && !hasText(holiday?.desc);
}

/** 加班費日別用：isCountedHoliday 為真，而且不是「說明為空的週末」 */
export function isPayableNationalHoliday(holiday) {
  return isCountedHoliday(holiday) && !isEmptyWeekendHoliday(holiday);
}

/**
 * 取得 [start, end) 區間內的國定假日日期集合（YYYY-MM-DD）。
 * 已啟用的國定假日移置（HolidayMoveSetting）會把來源日移除、目標日加入。
 */
export function buildCountedHolidayDays({ holidays = [], moves = [], start, end } = {}) {
  const days = new Set(
    (holidays || [])
      .filter(isPayableNationalHoliday)
      .map((holiday) => utcDateKey(holiday.date))
      .filter(Boolean),
  );
  const startKey = start ? utcDateKey(start) : '';
  const endKey = end ? utcDateKey(end) : '';
  for (const move of moves || []) {
    const source = move?.sourceDate ? utcDateKey(move.sourceDate) : '';
    const target = move?.targetDate ? utcDateKey(move.targetDate) : '';
    if (source) days.delete(source);
    if (target && (!startKey || target >= startKey) && (!endKey || target < endKey)) {
      days.add(target);
    }
  }
  return days;
}
