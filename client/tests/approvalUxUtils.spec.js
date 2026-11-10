import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import {
  formatTaipeiDateTime,
  pickerDateToTaipeiInstant,
  taipeiInstantToPickerDate,
} from '../src/utils/approvalDisplay'
import { getStatusTagType } from '../src/utils/approvalDetail'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  checkAttachmentFile,
  collectMissingRequiredFields,
} from '../src/utils/approvalForm'
import {
  LIST_FETCH_LIMIT,
  PAGE_SIZE,
  filterRequests,
  formatAge,
  formatTaipeiRange,
  hasActiveFilter,
  listQueryString,
  mergeFormOptions,
  listFormOptions,
  pageSlice,
  pagedListUrl,
  pickDefaultTab,
  requestFormId,
  sortByTime,
  stepProgressText,
  summarizeRequest,
  summaryText,
} from '../src/utils/approvalList'
import { describeBalanceBrief, formatHoursWithDays, pickBriefItems } from '../src/utils/leaveBalance'
import { useIsMobile } from '../src/utils/useIsMobile'

// 2026/11 簽核頁介面整理新增的工具：清單的篩選／排序／分頁／摘要、預設分頁、日期選擇器與台灣時間的換算、
// 附件檢查、欄位錯誤、假別的一句話餘額、手機寬度判斷

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('預設分頁（pickDefaultTab）', () => {
  it('有等我簽核的單先看待我簽核；有被退簽的單看我的申請；都沒有就直接填申請表單', () => {
    expect(pickDefaultTab({ inboxCount: 3, returnedCount: 1 })).toBe('inbox')
    expect(pickDefaultTab({ inboxCount: 0, returnedCount: 2 })).toBe('mine')
    expect(pickDefaultTab({ inboxCount: 0, returnedCount: 0 })).toBe('apply')
    expect(pickDefaultTab()).toBe('apply')
    expect(pickDefaultTab({ inboxCount: '2' })).toBe('inbox')
  })
})

describe('清單的篩選、排序、分頁', () => {
  const rows = [
    { _id: 'a', status: 'pending', form: { _id: 'f-leave', name: '請假' }, applicant_employee: { name: '王小明' }, createdAt: '2026-11-10T02:00:00.000Z' },
    { _id: 'b', status: 'approved', form: { _id: 'f-ot', name: '加班申請' }, applicant_employee: { name: '李小華' }, createdAt: '2026-11-08T15:30:00.000Z' },
    // 台灣時間 11/09 00:30（UTC 是 11/08 16:30）：日期篩選要算在 11/09
    { _id: 'c', status: 'returned', form: 'f-leave', applicant_employee: { name: '陳大雄' }, createdAt: '2026-11-08T16:30:00.000Z' },
    { _id: 'd', status: 'pending', form: { _id: 'f-ot', name: '加班申請' }, applicant_employee: { name: '王小明' }, createdAt: 'not a date' },
  ]
  const ids = (list) => list.map(row => row._id)

  it('表單（已展開或只有編號都認得）、狀態、關鍵字', () => {
    expect(requestFormId(rows[0])).toBe('f-leave')
    expect(requestFormId(rows[2])).toBe('f-leave')
    expect(requestFormId({})).toBe('')
    expect(ids(filterRequests(rows, { formId: 'f-leave' }))).toEqual(['a', 'c'])
    expect(ids(filterRequests(rows, { status: 'pending' }))).toEqual(['a', 'd'])
    expect(ids(filterRequests(rows, { keyword: ' 王小 ' }))).toEqual(['a', 'd'])
    expect(ids(filterRequests(rows, { keyword: '加班' }))).toEqual(['b', 'd'])
    expect(ids(filterRequests(rows, {}))).toEqual(['a', 'b', 'c', 'd'])
    expect(filterRequests(null, { status: 'pending' })).toEqual([])
  })

  it('日期範圍以台灣日期比對（含頭尾），時間讀不懂的列在有日期條件時不列出', () => {
    // 11/08 15:30Z 是台灣 11/08 23:30；11/08 16:30Z 是台灣 11/09 00:30
    expect(ids(filterRequests(rows, { from: '2026-11-09', to: '2026-11-09' }))).toEqual(['c'])
    expect(ids(filterRequests(rows, { from: '2026-11-08', to: '2026-11-08' }))).toEqual(['b'])
    expect(ids(filterRequests(rows, { from: '2026-11-09' }))).toEqual(['a', 'c'])
    expect(ids(filterRequests(rows, { to: '2026-11-09' }))).toEqual(['b', 'c'])
    // 我已簽核用簽核時間比對
    const history = [{ _id: 'h', createdAt: '2026-01-01T00:00:00.000Z', decidedAt: '2026-11-09T03:00:00.000Z' }]
    expect(ids(filterRequests(history, { from: '2026-11-09', to: '2026-11-09' }, { dateOf: row => row.decidedAt }))).toEqual(['h'])
    expect(filterRequests(history, { from: '2026-11-09', to: '2026-11-09' })).toEqual([])
  })

  it('排序不改動原陣列：asc 最早的在前（等最久的先處理）', () => {
    const source = rows.slice(0, 3)
    expect(ids(sortByTime(source, 'asc'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortByTime(source, 'desc'))).toEqual(['a', 'c', 'b'])
    expect(ids(source)).toEqual(['a', 'b', 'c'])
    expect(sortByTime(undefined)).toEqual([])
  })

  it('分頁：一頁 20 筆，頁碼超出範圍時回到最後一頁', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ _id: i }))
    expect(PAGE_SIZE).toBe(20)
    expect(pageSlice(many, 1)).toHaveLength(20)
    expect(pageSlice(many, 3).map(row => row._id)).toEqual([40, 41, 42, 43, 44])
    expect(pageSlice(many, 9).map(row => row._id)).toEqual([40, 41, 42, 43, 44])
    expect(pageSlice(many, 0)).toHaveLength(20)
    expect(pageSlice([], 2)).toEqual([])
  })

  it('一次向伺服器取 200 筆（伺服器每頁的上限）', () => {
    expect(LIST_FETCH_LIMIT).toBe(200)
    expect(pagedListUrl('/api/approvals/inbox', 2, LIST_FETCH_LIMIT)).toBe('/api/approvals/inbox?page=2&limit=200')
  })

  it('表單篩選的選項：清單裡出現過的表單，不重複、依名稱排序', () => {
    expect(listFormOptions(rows)).toEqual([
      { value: 'f-ot', label: '加班申請' },
      { value: 'f-leave', label: '請假' },
    ].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant')))
    expect(listFormOptions([{ form: 'x1' }])).toEqual([{ value: 'x1', label: '（未命名的表單）' }])
    expect(listFormOptions([{ form: 'x1' }], () => '舊表單')).toEqual([{ value: 'x1', label: '舊表單' }])
  })
})

describe('清單列的文字', () => {
  it('多久以前送出；還沒到的時間（測試資料）顯示剛剛，讀不懂的時間不顯示', () => {
    const now = new Date('2026-11-10T08:00:00.000Z').getTime()
    expect(formatAge('2026-11-10T07:59:40.000Z', now)).toBe('剛剛')
    expect(formatAge('2026-11-10T07:25:00.000Z', now)).toBe('35 分鐘前')
    expect(formatAge('2026-11-10T03:00:00.000Z', now)).toBe('5 小時前')
    expect(formatAge('2026-11-07T07:00:00.000Z', now)).toBe('3 天前')
    expect(formatAge('2026-11-20T07:00:00.000Z', now)).toBe('剛剛')
    expect(formatAge('', now)).toBe('')
    expect(formatAge(null, now)).toBe('')
    expect(formatAge('abc', now)).toBe('')
  })

  it('第幾關', () => {
    expect(stepProgressText({ current_step_index: 0, steps: [{}, {}] })).toBe('第 1／2 關')
    expect(stepProgressText({ current_step_index: 5, steps: [{}, {}] })).toBe('第 2／2 關')
    expect(stepProgressText({ current_step_index: null, steps: [{}] })).toBe('')
    expect(stepProgressText({ current_step_index: 0 })).toBe('')
  })

  it('起訖時間：同一天只寫一次日期，跨日兩邊都寫；只有日期的不多一個 00:00（都是台灣時間）', () => {
    // 01:00Z = 台灣 09:00
    expect(formatTaipeiRange('2026-11-12T01:00:00.000Z', '2026-11-12T10:00:00.000Z')).toBe('2026/11/12 09:00–18:00')
    expect(formatTaipeiRange('2026-11-12T01:00:00.000Z', '2026-11-14T10:00:00.000Z')).toBe('2026/11/12 09:00 – 2026/11/14 18:00')
    // 20:00Z 是台灣隔天 04:00：不能當成同一天
    expect(formatTaipeiRange('2026-11-12T10:00:00.000Z', '2026-11-12T20:00:00.000Z')).toBe('2026/11/12 18:00 – 2026/11/13 04:00')
    expect(formatTaipeiRange('2026-11-12', '2026-11-12')).toBe('2026/11/12')
    expect(formatTaipeiRange('2026-11-12', '2026-11-14')).toBe('2026/11/12 – 2026/11/14')
    expect(formatTaipeiRange('2026-11-12T01:00:00.000Z', '')).toBe('2026/11/12 09:00')
    expect(formatTaipeiRange('', '')).toBe('')
  })

  const leaveFields = [
    { _id: 'type', label: '假別', type_1: 'select', options: [{ label: '事假', value: 'personal' }], order: 1 },
    { _id: 'start', label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'end', label: '結束時間', type_1: 'datetime', order: 3 },
    { _id: 'hours', label: '時數', type_1: 'number', order: 4 },
    { _id: 'reason', label: '事由', type_1: 'textarea', order: 5 },
  ]

  it('請假單的摘要：假別・起訖・時數（時數旁附天數，1 天 = 8 小時；不滿一天只寫時數）', () => {
    const row = { form_data: { type: 'personal', start: '2026-11-12T01:00:00.000Z', end: '2026-11-13T10:00:00.000Z', hours: 16, reason: '家中有事' } }
    expect(summarizeRequest(row, leaveFields, { isLeave: true })).toBe('事假・2026/11/12 09:00 – 2026/11/13 18:00・16 小時（2 天）')
    const half = { form_data: { type: 'personal', start: '2026-11-12T01:00:00.000Z', end: '2026-11-12T05:00:00.000Z', hours: 4 } }
    expect(summarizeRequest(half, leaveFields, { isLeave: true })).toBe('事假・2026/11/12 09:00–13:00・4 小時')
    // 日期欄位（沒有時分）存的是台灣午夜的時間點：只顯示日期
    const dateFields = leaveFields.map(field => (field._id === 'start' || field._id === 'end' ? { ...field, type_1: 'date' } : field))
    const days = { form_data: { type: 'personal', start: '2026-11-11T16:00:00.000Z', end: '2026-11-12T16:00:00.000Z', hours: 16 } }
    expect(summarizeRequest(days, dateFields, { isLeave: true })).toBe('事假・2026/11/12 – 2026/11/13・16 小時（2 天）')
  })

  it('其他表單：有起訖就寫成一段，再取前面有填的文字、數字、選項欄位；附件、勾選、停用的欄位不算', () => {
    const overtime = { form_data: { start: '2026-11-18T18:00:00.000Z', end: '2026-11-18T21:00:00.000Z', reason: '系統維護  \n 夜間', file: [{ name: 'a.pdf', url: '/x' }] } }
    const fields = [
      { _id: 'start', label: '開始時間', type_1: 'datetime', order: 1 },
      { _id: 'end', label: '結束時間', type_1: 'datetime', order: 2 },
      { _id: 'file', label: '附件', type_1: 'file', order: 3 },
      { _id: 'reason', label: '事由', type_1: 'textarea', order: 4 },
    ]
    expect(summarizeRequest(overtime, fields)).toBe('2026/11/19 02:00–05:00・事由：系統維護 夜間')

    const bonus = { form_data: { kind: '推薦獎金', amount: 14559, hidden: '不該出現', note: 'x'.repeat(40) } }
    const bonusFields = [
      { _id: 'hidden', label: '停用欄位', type_1: 'text', is_active: false, order: 0 },
      { _id: 'kind', label: '獎金類型', type_1: 'text', order: 1 },
      { _id: 'amount', label: '金額', type_1: 'number', order: 2 },
      { _id: 'note', label: '備註', type_1: 'textarea', order: 3 },
    ]
    expect(summarizeRequest(bonus, bonusFields)).toBe('獎金類型：推薦獎金・金額：14559')
    expect(summarizeRequest(bonus, bonusFields, { maxParts: 3 })).toBe(`獎金類型：推薦獎金・金額：14559・備註：${'x'.repeat(24)}…`)
  })

  it('沒有欄位資料（例如別的部門的表單讀不到欄位）或沒有填寫內容時不顯示摘要', () => {
    expect(summarizeRequest({ form_data: { a: 1 } }, [])).toBe('')
    expect(summarizeRequest({ form_data: { a: 1 } }, undefined)).toBe('')
    expect(summarizeRequest({}, leaveFields, { isLeave: true })).toBe('')
    expect(summarizeRequest({ form_data: {} }, leaveFields, { isLeave: true })).toBe('')
  })
})

describe('狀態標籤的顏色（三份清單與明細共用）', () => {
  it('待簽核橘、已核可綠、已否決紅、已退簽藍、已撤回與其他灰', () => {
    expect(['pending', 'approved', 'rejected', 'returned', 'canceled', 'skipped', 'x'].map(getStatusTagType))
      .toEqual(['warning', 'success', 'danger', 'primary', 'info', 'info', 'info'])
  })
})

describe('日期／時間選擇器與台灣時間', () => {
  // 模擬一台時區是 UTC 的裝置：選擇器回傳的 Date，本地的年月日時分就是 UTC 的年月日時分
  class UtcDeviceDate extends Date {
    getFullYear() { return this.getUTCFullYear() }
    getMonth() { return this.getUTCMonth() }
    getDate() { return this.getUTCDate() }
    getHours() { return this.getUTCHours() }
    getMinutes() { return this.getUTCMinutes() }
    getSeconds() { return this.getUTCSeconds() }
    getMilliseconds() { return this.getUTCMilliseconds() }
  }

  it('選擇器上選的時間一律當成台灣時間：不管測試機在哪個時區，選 11/12 09:00 送出的就是台灣時間 11/12 09:00', () => {
    const picked = new Date(2026, 10, 12, 9, 0, 0)
    const instant = pickerDateToTaipeiInstant(picked)
    expect(instant.toISOString()).toBe('2026-11-12T01:00:00.000Z')
    expect(formatTaipeiDateTime(instant)).toBe('2026/11/12 09:00')
  })

  it('裝置時區不是台灣（例如 UTC）時也一樣：以前會送出 UTC 的 09:00（台灣 17:00），日期欄位還會差一天', () => {
    // UTC 裝置上選「11/12 09:00」得到的 Date 是 09:00Z
    const picked = new UtcDeviceDate('2026-11-12T09:00:00.000Z')
    expect(pickerDateToTaipeiInstant(picked).toISOString()).toBe('2026-11-12T01:00:00.000Z')
    // 日期欄位：UTC 裝置上選「11/12」得到 11/12 00:00Z，換成台灣 11/12 的午夜（不是 11/12 08:00，也不會變成前一天）
    const day = new UtcDeviceDate('2026-11-12T00:00:00.000Z')
    expect(pickerDateToTaipeiInstant(day).toISOString()).toBe('2026-11-11T16:00:00.000Z')
  })

  it('表單裡的時間點顯示在選擇器上時換成台灣的年月日時分，原樣送回去不會改變', () => {
    const shown = taipeiInstantToPickerDate('2026-11-12T01:00:00.000Z')
    expect([shown.getFullYear(), shown.getMonth(), shown.getDate(), shown.getHours(), shown.getMinutes()]).toEqual([2026, 10, 12, 9, 0])
    expect(pickerDateToTaipeiInstant(shown).toISOString()).toBe('2026-11-12T01:00:00.000Z')
    const fromDate = taipeiInstantToPickerDate(new Date('2026-12-31T16:30:00.000Z'))
    expect([fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), fromDate.getHours(), fromDate.getMinutes()]).toEqual([2027, 0, 1, 0, 30])
  })

  it('不含時區的字串已經是台灣時間：照字面顯示；空值與讀不懂的值原樣回傳', () => {
    const day = taipeiInstantToPickerDate('2026-11-12')
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 10, 12, 0])
    const naive = taipeiInstantToPickerDate('2026-11-12 14:30')
    expect([naive.getDate(), naive.getHours(), naive.getMinutes()]).toEqual([12, 14, 30])
    const time = taipeiInstantToPickerDate('08:15')
    expect([time.getHours(), time.getMinutes()]).toEqual([8, 15])
    expect(taipeiInstantToPickerDate('')).toBe('')
    expect(taipeiInstantToPickerDate(null)).toBe(null)
    expect(taipeiInstantToPickerDate('明天')).toBe('明天')
    expect(pickerDateToTaipeiInstant(null)).toBe(null)
    expect(pickerDateToTaipeiInstant('2026-11-12')).toBe('2026-11-12')
  })
})

describe('必填欄位與附件檢查', () => {
  const fields = [
    { _id: 'amount', label: '金額', type_1: 'number', required: true },
    { _id: 'reason', label: '事由', type_1: 'textarea', required: true },
    { _id: 'proof', label: '證明', type_1: 'file', required: true },
    { _id: 'note', label: '備註', type_1: 'text' },
    { _id: 'cross', label: '是否跨日', type_1: 'checkbox', required: true },
    { _id: 'off', label: '停用', type_1: 'text', required: true, is_active: false },
  ]

  it('列出每一個沒填的必填欄位（不是只有第一個），訊息顯示在各自的欄位下方', () => {
    expect(collectMissingRequiredFields(fields, { amount: null, reason: ' ', cross: false }, {})).toEqual({
      amount: '請填寫金額',
      reason: '請填寫事由',
      proof: '請選擇證明的檔案',
    })
    expect(collectMissingRequiredFields(fields, { amount: 0, reason: '有' }, { proof: [{ name: 'a.pdf' }] })).toEqual({})
    // 重新送出：保留原本的附件也算有填
    expect(collectMissingRequiredFields(fields, { amount: 1, reason: '有' }, {}, { proof: true })).toEqual({})
    expect(collectMissingRequiredFields(null, {})).toEqual({})
  })

  it('附件：格式與大小在選檔當下就檢查，說明是哪個檔案、為什麼（限制與伺服器相同）', () => {
    expect(ATTACHMENT_ACCEPT).toBe('.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp')
    expect(checkAttachmentFile({ name: '診斷書.PDF', size: 1024 })).toBe('')
    expect(checkAttachmentFile({ name: 'photo.jpeg', size: MAX_ATTACHMENT_BYTES })).toBe('')
    expect(checkAttachmentFile({ name: 'setup.exe', size: 10 })).toBe('「setup.exe」的格式不支援，請上傳 PDF、Word、Excel 或圖片')
    expect(checkAttachmentFile({ name: '沒有副檔名', size: 10 })).toContain('格式不支援')
    expect(checkAttachmentFile({ name: 'big.pdf', size: 12.34 * 1024 * 1024 })).toBe('「big.pdf」有 12.3 MB，超過每個檔案 10 MB 的上限')
    expect(checkAttachmentFile(new File([], 'empty.pdf'))).toBe('「empty.pdf」是空的檔案，請確認後重新選擇')
    expect(checkAttachmentFile(null)).toBe('')
  })
})

describe('假別的時數與一句話餘額', () => {
  it('不滿一天（或 0）只寫時數，不再出現「4 小時（4 小時）」', () => {
    expect(formatHoursWithDays(4)).toBe('4 小時')
    expect(formatHoursWithDays(0)).toBe('0 小時')
    expect(formatHoursWithDays(7.5)).toBe('7.5 小時')
    expect(formatHoursWithDays(8)).toBe('8 小時（1 天）')
    expect(formatHoursWithDays(12)).toBe('12 小時（1 天 4 小時）')
    expect(formatHoursWithDays(-12)).toBe('-12 小時（-1 天 4 小時）')
    expect(formatHoursWithDays(undefined)).toBe('—')
  })

  const items = [
    { key: 'annual', name: '特休', source: 'employee', period: 'year', status: 'ok', quotaHours: 80, remainingHours: 64, availableHours: 56 },
    { key: 'comp', name: '調休', aliases: ['移休', '補休'], source: 'bank', period: 'none', status: 'bank', quotaHours: 24, remainingHours: 12, availableHours: 8 },
    { key: 'personal', name: '事假', source: 'policy', period: 'year', status: 'ok', quotaHours: 112, remainingHours: 68, availableHours: 60 },
    { key: 'family_care', name: '家庭照顧假', source: 'policy', period: 'year', status: 'ok', quotaHours: 56, remainingHours: 56, availableHours: 56, countsAgainst: { key: 'personal', exemptHours: 0 } },
    { key: 'marriage', name: '婚假', source: 'policy', period: 'event', status: 'ok', quotaHours: 64, remainingHours: null, availableHours: null },
    { key: 'official', name: '公假', source: 'policy', period: 'none', status: 'unlimited', quotaHours: null, remainingHours: null, availableHours: null },
  ]

  // 伺服器送出特休時以可用時數（剩餘 - 其他簽核中的特休）把關：特休也看可用，和調休、其他假別相同
  it('一句話餘額與送出時的檢查用同一個數字：特休、調休與其他假別都看可用（剩餘 - 簽核中）', () => {
    expect(items.map(describeBalanceBrief)).toEqual([
      '特休 可請 56 小時（7 天）',
      '調休 可請 8 小時（1 天）',
      '事假 可請 60 小時（7 天 4 小時）',
      '家庭照顧假 可請 56 小時（7 天）',
      '婚假 每次上限 64 小時',
      '公假 不設上限',
    ])
    expect(describeBalanceBrief({ name: '特休', source: 'employee', status: 'unconfigured', quotaHours: 0, remainingHours: 0 })).toBe('特休 尚未設定')
    expect(describeBalanceBrief({ name: '原民假', status: 'ineligible' })).toBe('原民假 限具原住民身分者')
    // 舊版伺服器的特休沒有 availableHours：退回剩餘時數
    expect(describeBalanceBrief({ name: '特休', source: 'employee', quotaHours: 80, remainingHours: 40 })).toBe('特休 可請 40 小時（5 天）')
    expect(describeBalanceBrief({ name: '事假', source: 'policy', period: 'year', quotaHours: 112, remainingHours: -4, availableHours: -4 })).toBe('事假 可請 0 小時')
    expect(describeBalanceBrief(null)).toBe('')
  })

  it('假別下方列哪些假別：還沒選時是特休與調休；選了就是那個假別（別名也認得），併入其他假別的再加上被併入的', () => {
    expect(pickBriefItems(items, '').map(item => item.name)).toEqual(['特休', '調休'])
    expect(pickBriefItems(items, '事假').map(item => item.name)).toEqual(['事假'])
    expect(pickBriefItems(items, '移休').map(item => item.name)).toEqual(['調休'])
    expect(pickBriefItems(items, '家庭照顧假').map(item => item.name)).toEqual(['家庭照顧假', '事假'])
    expect(pickBriefItems(items, '神祕假').map(item => item.name)).toEqual(['特休', '調休'])
    expect(pickBriefItems(null, '事假')).toEqual([])
  })
})

describe('手機寬度判斷（useIsMobile）', () => {
  function stubMatchMedia(matches) {
    const listeners = new Set()
    const media = {
      matches,
      addEventListener: vi.fn((_, listener) => listeners.add(listener)),
      removeEventListener: vi.fn((_, listener) => listeners.delete(listener)),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    return { media, listeners, emit: (value) => listeners.forEach(listener => listener({ matches: value })) }
  }
  const Probe = defineComponent({
    setup() {
      const isMobile = useIsMobile()
      return () => h('span', isMobile.value ? 'mobile' : 'desktop')
    },
  })

  it('沒有 matchMedia 的環境當成桌機', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(mount(Probe).text()).toBe('desktop')
  })

  it('寬度小於 768px 是手機；視窗變寬會跟著變；元件卸載時移除監聽', async () => {
    const { media, listeners, emit } = stubMatchMedia(true)
    const wrapper = mount(Probe)
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)')
    expect(wrapper.text()).toBe('mobile')
    emit(false)
    await nextTick()
    expect(wrapper.text()).toBe('desktop')
    wrapper.unmount()
    expect(media.removeEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })
})

describe('清單的伺服器篩選與摘要（docs/approval-list-api.md）', () => {
  it('篩選條件換成清單 API 的參數；空白不送、關鍵字修剪並限制 50 字、起訖選反了對調', () => {
    expect(listQueryString({ page: 2 })).toBe('page=2&limit=20')
    expect(listQueryString({
      filter: { formId: 'f1', status: 'pending', keyword: '  王小明 ', from: '2026-11-01', to: '2026-11-30' },
      sort: 'oldest',
    })).toBe(`page=1&limit=20&status=pending&form=f1&from=2026-11-01&to=2026-11-30&q=${encodeURIComponent('王小明')}&sort=oldest`)
    expect(listQueryString({ filter: { from: '2026-11-30', to: '2026-11-01' } })).toBe('page=1&limit=20&from=2026-11-01&to=2026-11-30')
    const long = 'a'.repeat(60)
    expect(new URLSearchParams(listQueryString({ filter: { keyword: long } })).get('q')).toHaveLength(50)
    expect(listQueryString({ filter: { keyword: '   ' } })).toBe('page=1&limit=20')
    expect(hasActiveFilter({ keyword: '  ' })).toBe(false)
    expect(hasActiveFilter({ to: '2026-11-01' })).toBe(true)
    expect(hasActiveFilter(null)).toBe(false)
  })

  it('表單篩選的選項：可以申請的表單加上清單裡看過的表單，不重複、依名稱排序', () => {
    expect(mergeFormOptions([{ _id: 'f2', name: '請假' }, { _id: 'f1', name: '加班申請' }], { f2: '請假', f9: '跨部門支援' })).toEqual([
      { value: 'f1', label: '加班申請' },
      { value: 'f9', label: '跨部門支援' },
      { value: 'f2', label: '請假' },
    ])
    expect(mergeFormOptions(null, { x: '' })).toEqual([{ value: 'x', label: '（未命名的表單）' }])
  })

  it('伺服器的 summary 寫成一行：請假單假別・起訖・時數；其他表單起訖在前、不重複列開始結束', () => {
    const leave = {
      kind: 'leave', leaveType: '事假', hours: 16, start: '2026-11-12T01:00:00.000Z', end: '2026-11-13T10:00:00.000Z', dateOnly: false,
      items: [{ label: '假別', value: '事假' }],
    }
    expect(summaryText(leave)).toBe('事假・2026/11/12 09:00 – 2026/11/13 18:00・16 小時（2 天）')
    expect(summaryText({ ...leave, start: '2026-11-12', end: '2026-11-13', dateOnly: true })).toBe('事假・2026/11/12 – 2026/11/13・16 小時（2 天）')
    expect(summaryText({ ...leave, hours: null, start: null, end: null })).toBe('事假')
    // 請假單什麼都組不出來時退回 items
    expect(summaryText({ kind: 'leave', leaveType: null, hours: null, items: [{ label: '事由', value: '家裡有事' }] })).toBe('事由：家裡有事')

    const overtime = {
      kind: 'fields', start: '2026-11-12T10:00:00.000Z', end: '2026-11-12T12:00:00.000Z', dateOnly: false,
      items: [{ label: '開始時間', value: '2026/11/12 18:00' }, { label: '結束時間', value: '2026/11/12 20:00' }, { label: '事由', value: '盤點'.repeat(20) }],
    }
    expect(summaryText(overtime)).toBe(`2026/11/12 18:00–20:00・事由：${'盤點'.repeat(12)}…`)
    expect(summaryText({ kind: 'fields', items: [{ label: '事由', value: '補充 夜班用品' }, { label: '金額', value: '1200' }, { label: '備註', value: 'x' }] }))
      .toBe('事由：補充 夜班用品・金額：1200')
    expect(summaryText(null)).toBe('')
    expect(summaryText({ kind: 'fields' })).toBe('')
  })
})
