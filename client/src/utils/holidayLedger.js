// 國定假日休假紀錄（排班頁「國定假日休假」視窗）用的文字與狀態判斷。
// 狀態值對應 server/src/services/holidayRestLedgerService.js：
//   status：rested_on_date 當日休（implicit = 行政人員依行事曆放假）／moved 移休／compensated 已補假／not_taken 未休／na 不適用
//   reason（未休時假日當天的狀態）：worked／unscheduled／on_rest_day／on_regular_rest／on_leave／shared_date
//   needsAction：null／schedule（班表還沒排完，請排國）／resolve（請登記處理方式）／assign_compensation（落在休息日／例假，請排補假）
//   compensation：補假（{ date, via: gov_makeup 公務機關補假日／assigned 人資排定, conflict, conflictReason: trigger_gone／date_not_workday }）或待排的補假義務（{ id, status: open, suggestedDate }）
//   resolutionConflict：已登記過處理方式，但班表之後又排了「國」（變成當日休或移休），要人確認

export const RESOLUTION_OPTIONS = [
  { value: 'compensatory_leave', label: '補休' },
  { value: 'paid', label: '折發工資' },
  { value: 'rested_later', label: '已另行補休' },
  { value: 'waived', label: '不補' },
]

// 篩選的值同時是匯出時送給伺服器的 status（all 不送），名稱要和 server/src/controllers/holidayLedgerController.js 一致
export const LEDGER_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'notTaken', label: '未休' },
  { value: 'moved', label: '移休' },
  { value: 'open', label: '待處理' },
  { value: 'extra', label: '多排的國' },
  { value: 'compensation', label: '待排補假' },
]

// 已登記處理方式、班表卻已經有「國」的格子要顯示的提醒
export const LEDGER_CONFLICT_TEXT = '已登記處理但班表已有國，請確認'

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

/** 假日欄位表頭：「中秋節」「09/25（五）」，公司挪移過的另外註明原本日期；只因個人調移出現的欄位註明「個人調移」 */
export function describeHolidayHeader(holiday = {}) {
  let note = ''
  if (holiday.personal) note = '個人調移'
  else if (holiday.movedFrom) note = `公司挪移自 ${formatMonthDay(holiday.movedFrom)}`
  return {
    name: holiday.name || '國定假日',
    date: `${formatMonthDay(holiday.date)}（${weekdayLabel(holiday.date)}）`,
    note,
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

/** 登記者的說明：「主管王 登記」；最初登記的人與最後修改的人不同時一併註明 */
export function describeResolutionAuthor(resolution) {
  const last = resolution?.resolvedByName || ''
  const first = resolution?.createdByName || ''
  if (!last && !first) return ''
  if (!first || first === last) return `${last} 登記`
  return last ? `${last} 登記（最初：${first}）` : `${first} 登記`
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
  const cell = describeBaseCell(item)
  if (!item?.resolutionConflict) return cell
  // 已登記處理方式、班表之後才排了「國」：仍顯示休假狀態，但改用警告色並註明要確認
  return { ...cell, type: 'warning', tooltip: [cell.tooltip, LEDGER_CONFLICT_TEXT].filter(Boolean).join('；') }
}

function describeBaseCell(item) {
  if (!item) return { text: '', type: 'info', tooltip: '' }
  // 已排補假、班表之後又改了：補假不會自動取消，請人確認
  if (item.compensation?.conflict && item.compensation?.date) {
    const date = formatMonthDay(item.compensation.date)
    return {
      text: `補假 ${date}（班表已變更，請確認）`,
      type: 'warning',
      // date_not_workday：補假日之後被排成休息日／例假（行政人員：公司行事曆不是上班日），員工並沒有因此多休一天
      tooltip: item.compensation.conflictReason === 'date_not_workday'
        ? `補假日 ${date} 現在是休息日／例假（不是原本要上班的日子），員工並沒有因此多休一天，請改排其他上班日`
        : '已排定補假，但這個國定假日現在已經不是落在休息日／例假（班表改過），請確認補假是否仍需要',
    }
  }
  if (item.status === 'rested_on_date' && item.implicit) {
    return { text: '依行事曆放假', type: 'success', tooltip: '行政人員當天沒有班表，依公司行事曆放假' }
  }
  if (item.status === 'rested_on_date') {
    return { text: '當日休', type: 'success', tooltip: `${formatMonthDay(item.guoDate)} 排了「國」` }
  }
  if (item.status === 'compensated') {
    const government = item.compensation?.via === 'gov_makeup'
    return {
      text: `補假 ${formatMonthDay(item.compensation?.date)}${government ? '（公務機關補假日）' : ''}`,
      type: 'success',
      tooltip: government
        ? '國定假日落在週末，行政人員依政府公告的補假日放假'
        : '國定假日落在休息日／例假，已和員工協商另排補假',
    }
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
  if (item.needsAction === 'assign_compensation') {
    const suggested = item.compensation?.suggestedDate ? `；系統建議 ${formatMonthDay(item.compensation.suggestedDate)}` : ''
    return {
      text: '待排補假',
      type: 'danger',
      tooltip: `國定假日剛好是${item.reason === 'on_regular_rest' ? '例假' : '休息日'}，依勞基法施行細則第 23-1 條要另排補假（日期由勞雇雙方協商）${suggested}`,
    }
  }
  if (item.needsAction === 'schedule') {
    return { text: '尚未排國', type: 'warning', tooltip: '班表還是草稿，這個國定假日還沒有對應的「國」；排好「國」後會自動變成移休' }
  }
  if (item.reason === 'unscheduled' && !item.needsAction) {
    // 沒有待處理的「未排班」只會是兼職人員（兼職不要求排班），僅供參考
    return { text: '未休·未排班', type: 'info', tooltip: '國定假日當天沒有排班，本月也沒有排「國」；兼職人員不要求排班，僅供參考，不列入待處理' }
  }
  return REASON_TEXT[item.reason] || { text: '未休', type: 'danger', tooltip: '' }
}

/** 這個儲存格是否要顯示「登記處理」／「修改」／「檢視登記」按鈕（班表還沒排完的「請排國」不開放登記；登記與班表衝突的要能檢視、刪除） */
export function canRecordResolution(item) {
  if (item?.resolutionConflict) return true
  return item?.status === 'not_taken' && (item.needsAction === 'resolve' || Boolean(item.resolution))
}

/** 按鈕上的文字 */
export function resolveButtonLabel(item) {
  if (item?.resolutionConflict) return '檢視登記'
  return item?.resolution ? '修改' : '登記處理'
}

/** 目前登入者的員工 _id（登入時存在 sessionStorage／localStorage 的 employeeId，排班頁、個人資料用的是同一個來源）；讀不到回傳空字串 */
export function getViewerEmployeeId() {
  if (typeof window === 'undefined') return ''
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const value = storage?.getItem('employeeId')
      if (value && value !== 'undefined') return value
    } catch (error) {
      // 無痕視窗或封鎖網站資料時讀不到，視為不知道是誰
    }
  }
  return ''
}

/**
 * 這個儲存格要不要顯示登記按鈕：要有權限、項目本身可以登記；
 * 主管不能替自己登記（伺服器會拒絕，一律回「沒有權限」），勾「包含自己」時自己那一列就不顯示按鈕。管理員不受限。
 */
export function canShowResolveButton({ canResolve, role, viewerId, row, item } = {}) {
  if (!canResolve || !canRecordResolution(item)) return false
  return !(role === 'supervisor' && viewerId && row?.employeeId === viewerId)
}

/**
 * 這個儲存格要不要顯示「排定補假」按鈕：待排補假（需要有補假義務的 id）或已由人資排定的補假（可以修改、取消），
 * 權限規則和登記處理方式相同（主管不能處理自己）。
 */
export function canShowCompensationButton({ canResolve, role, viewerId, row, item } = {}) {
  if (!canResolve || !item) return false
  const waiting = item.needsAction === 'assign_compensation' && Boolean(item.compensation?.id)
  const assigned = item.compensation?.via === 'assigned' && Boolean(item.compensation?.compensationId)
  if (!waiting && !assigned) return false
  return !(role === 'supervisor' && viewerId && row?.employeeId === viewerId)
}

/** 個人調移按鈕：要有權限，主管不能替自己登記 */
export function canShowSwapButton({ canResolve, role, viewerId, row } = {}) {
  if (!canResolve || !row) return false
  return !(role === 'supervisor' && viewerId && row.employeeId === viewerId)
}

/** 補假視窗要顯示的原因：適逢休息日／例假 */
export function compensationReasonText(item) {
  if (item?.reason === 'on_regular_rest' || item?.dateKind === 'regular_rest') return '適逢例假'
  return '適逢休息日'
}

export const CONSENT_REQUIRED_TEXT = '個人調移必須有員工本人的同意紀錄（簽名、同意書或電子紀錄）'
export const SWAP_WARNING_TEXT = '依勞動部解釋，國定假日與工作日對調須經員工本人同意（工會同意不能取代）；調移後原假日為一般工作日'
export const INDIGENOUS_TOOLTIP = '歲時祭儀 3 日，以原民假申請'

/** 個人調移表單的檢查：回傳要提醒的訊息，沒問題回傳空字串 */
export function validateSwapForm(form = {}) {
  if (!form.originalDate) return '請選擇原國定假日'
  if (!form.targetDate) return '請選擇調移到的日期'
  if (form.originalDate === form.targetDate) return '調移日不能和原國定假日相同'
  if (!form.consentMethod || !form.consentedAt || !String(form.evidenceRef ?? '').trim()) return CONSENT_REQUIRED_TEXT
  return ''
}

/** 個人調移送給伺服器的內容 */
export function buildSwapBody(form = {}) {
  return {
    employee: form.employee,
    originalDate: form.originalDate,
    targetDate: form.targetDate,
    reason: String(form.reason ?? '').trim(),
    consent: {
      method: form.consentMethod,
      consentedAt: form.consentedAt,
      evidenceRef: String(form.evidenceRef ?? '').trim(),
      note: String(form.consentNote ?? '').trim(),
    },
  }
}

/** 員工列是否符合篩選（全部／未休／移休／待處理／多排的國／待排補假） */
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
    case 'compensation':
      return (row.items || []).some((item) => item.needsAction === 'assign_compensation')
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

/**
 * 查詢字串：沿用排班頁目前的月份／部門／單位／包含自己。
 * 匯出時另外帶目前的篩選（status，all 不送）與搜尋文字（search），匯出的就是畫面上看到的那些員工。
 */
export function buildLedgerQuery({ month, department, subDepartment, includeSelf, status, search } = {}) {
  const params = new URLSearchParams()
  if (month) params.set('month', month)
  if (department) params.set('department', department)
  if (subDepartment) params.set('subDepartment', subDepartment)
  if (includeSelf) params.set('includeSelf', 'true')
  if (status && status !== 'all') params.set('status', status)
  const keyword = String(search ?? '').trim()
  if (keyword) params.set('search', keyword)
  return params.toString()
}
