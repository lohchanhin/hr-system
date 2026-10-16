// 國定假日休假紀錄（排班頁「國定假日休假」視窗）用的文字與狀態判斷。
// 狀態值對應 server/src/services/holidayRestLedgerService.js：
//   status：rested_on_date 當日休／moved 移休／not_taken 未休／na 不適用
//   reason（未休時假日當天的狀態）：worked／unscheduled／on_rest_day／on_regular_rest／on_leave／shared_date
//   needsAction：null／schedule（班表還沒排完，請排國）／resolve（請登記處理方式）

export const RESOLUTION_OPTIONS = [
  { value: 'compensatory_leave', label: '補休' },
  { value: 'paid', label: '折發工資' },
  { value: 'rested_later', label: '已另行補休' },
  { value: 'waived', label: '不補' },
]

export const LEDGER_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'notTaken', label: '未休' },
  { value: 'moved', label: '移休' },
  { value: 'open', label: '待處理' },
  { value: 'extra', label: '多排的國' },
]

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

const NA_REASON_LABELS = {
  before_hire: '到職前',
  after_resignation: '離職後',
  leave_of_absence: '留職停薪',
}

/** 'YYYY-MM-DD' -> 'MM/DD'（直接切字串，不經過時區換算） */
export function formatMonthDay(dateKey) {
  const text = String(dateKey || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? `${text.slice(5, 7)}/${text.slice(8, 10)}` : ''
}

/** 'YYYY-MM-DD' -> '一'～'日'；日期無效時回傳空字串 */
export function weekdayLabel(dateKey) {
  const text = String(dateKey || '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return ''
  const day = new Date(`${text.slice(0, 10)}T00:00:00.000Z`).getUTCDay()
  return Number.isNaN(day) ? '' : WEEKDAY_LABELS[day]
}

/** 假日欄位表頭：「中秋節」「09/25（五）」，公司挪移過的另外註明原本日期 */
export function describeHolidayHeader(holiday = {}) {
  return {
    name: holiday.name || '國定假日',
    date: `${formatMonthDay(holiday.date)}（${weekdayLabel(holiday.date)}）`,
    note: holiday.movedFrom ? `公司挪移自 ${formatMonthDay(holiday.movedFrom)}` : '',
  }
}

/** 處理方式的一行文字，例如「補休 8 小時」「已另行補休 2026-10-03」「不補（員工放棄）」 */
export function describeResolution(resolution) {
  if (!resolution) return ''
  const label = RESOLUTION_OPTIONS.find((option) => option.value === resolution.kind)?.label || '已處理'
  let text = label
  if (resolution.kind === 'compensatory_leave' && resolution.compensatoryHours != null) {
    text = `${label} ${resolution.compensatoryHours} 小時`
  } else if (resolution.kind === 'rested_later' && resolution.restedDate) {
    text = `${label} ${resolution.restedDate}`
  }
  return resolution.note ? `${text}（${resolution.note}）` : text
}

const REASON_TEXT = {
  worked: { text: '未休·上班', type: 'danger', tooltip: '國定假日當天上班，本月沒有排「國」' },
  unscheduled: { text: '未休·未排班', type: 'warning', tooltip: '國定假日當天沒有排班，本月也沒有排「國」' },
  shared_date: { text: '未休·同日多個假日', type: 'danger', tooltip: '同一天有多個國定假日，但只排了一個「國」' },
  on_rest_day: { text: '適逢休息日', type: 'info', tooltip: '國定假日剛好是休息日，僅供參考，不列入待處理' },
  on_regular_rest: { text: '適逢例假', type: 'info', tooltip: '國定假日剛好是例假，僅供參考，不列入待處理' },
  on_leave: { text: '適逢請假', type: 'info', tooltip: '國定假日當天已核准請假，僅供參考，不列入待處理' },
}

/**
 * 一個員工 × 一個國定假日的儲存格：{ text, type（el-tag 的 type）, tooltip }。
 * 一律用文字標示，不能只靠顏色區分。
 */
export function describeLedgerCell(item) {
  if (!item) return { text: '', type: 'info', tooltip: '' }
  if (item.status === 'rested_on_date') {
    return { text: '當日休', type: 'success', tooltip: `${formatMonthDay(item.guoDate)} 排了「國」` }
  }
  if (item.status === 'moved') {
    const offset = Number(item.offsetDays)
    const direction = Number.isFinite(offset) && offset !== 0 ? `比假日${offset > 0 ? '晚' : '早'} ${Math.abs(offset)} 天` : ''
    const original = item.movedFrom ? `；公司已將假日從 ${formatMonthDay(item.movedFrom)} 挪到 ${formatMonthDay(item.holidayDate)}` : ''
    const worked = item.dateKind === 'work' ? '；假日當天有排班上班' : ''
    return {
      text: `移休 ${formatMonthDay(item.guoDate)}`,
      type: 'primary',
      tooltip: `${formatMonthDay(item.guoDate)} 排了「國」${direction ? `（${direction}）` : ''}${original}${worked}`,
    }
  }
  if (item.status === 'na') {
    return { text: '—', type: 'info', tooltip: NA_REASON_LABELS[item.reason] || '不適用' }
  }
  if (item.resolution) {
    return { text: `未休·${describeResolution(item.resolution)}`, type: 'info', tooltip: '已登記處理方式' }
  }
  if (item.needsAction === 'schedule') {
    return { text: '尚未排國', type: 'warning', tooltip: '班表還是草稿，這個國定假日還沒有對應的「國」；排好「國」後會自動變成移休' }
  }
  return REASON_TEXT[item.reason] || { text: '未休', type: 'danger', tooltip: '' }
}

/** 這個儲存格是否要顯示「登記處理」／「修改」按鈕（班表還沒排完的「請排國」不開放登記） */
export function canRecordResolution(item) {
  return item?.status === 'not_taken' && (item.needsAction === 'resolve' || Boolean(item.resolution))
}

/** 員工列是否符合篩選（全部／未休／移休／待處理／多排的國） */
export function ledgerRowMatchesFilter(row, filter) {
  if (!row) return false
  switch (filter) {
    case 'notTaken':
      return row.notTaken > 0
    case 'moved':
      return row.moved > 0
    case 'open':
      return row.open > 0
    case 'extra':
      return (row.extraGuoDates || []).length > 0
    default:
      return true
  }
}

export function countLedgerFilters(rows = []) {
  const counts = {}
  for (const filter of LEDGER_FILTERS) {
    counts[filter.value] = rows.filter((row) => ledgerRowMatchesFilter(row, filter.value)).length
  }
  return counts
}

/** 查詢字串：沿用排班頁目前的月份／部門／單位／包含自己 */
export function buildLedgerQuery({ month, department, subDepartment, includeSelf } = {}) {
  const params = new URLSearchParams()
  if (month) params.set('month', month)
  if (department) params.set('department', department)
  if (subDepartment) params.set('subDepartment', subDepartment)
  if (includeSelf) params.set('includeSelf', 'true')
  return params.toString()
}
