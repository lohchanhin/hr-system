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

/**
 * 某個月份「有效的國定假日」清單（國定假日休假紀錄、匯入核對用）。
 * 只取算數的國定假日（isPayableNationalHoliday），同一天重複的紀錄只留一筆；
 * 已啟用、來源日與目標日都在這個月份、且來源日確實有這個假日的挪移，會把假日移到目標日
 * （和排班頁 GET /api/holidays-public/by-month 的規則一致）。
 * 回傳 [{ id, name, originalDate, date, movedFrom }]，依有效日期排序：
 * id = 原始日期（YYYY-MM-DD，不隨公司挪移改變），date = 有效日期，movedFrom = 被公司挪移前的日期或 null。
 */
export function buildEffectiveMonthHolidays({ holidays = [], moves = [], month } = {}) {
  const prefix = String(month ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(prefix)) return [];

  const byDate = new Map();
  for (const holiday of holidays || []) {
    if (!isPayableNationalHoliday(holiday)) continue;
    const key = utcDateKey(holiday.date);
    if (!key || !key.startsWith(prefix) || byDate.has(key)) continue;
    byDate.set(key, {
      id: key,
      name: String(holiday.name || holiday.description || holiday.desc || '國定假日').trim() || '國定假日',
      originalDate: key,
      date: key,
      movedFrom: null,
    });
  }

  for (const move of moves || []) {
    if (move?.enableHolidayMove === false) continue;
    const source = move?.sourceDate ? utcDateKey(move.sourceDate) : '';
    const target = move?.targetDate ? utcDateKey(move.targetDate) : '';
    if (!source || !target || source === target) continue;
    if (!source.startsWith(prefix) || !target.startsWith(prefix)) continue;
    const holiday = byDate.get(source);
    if (!holiday || holiday.movedFrom) continue;
    holiday.date = target;
    holiday.movedFrom = source;
  }

  return [...byDate.values()].sort((a, b) => (
    a.date.localeCompare(b.date) || a.originalDate.localeCompare(b.originalDate)
  ));
}
