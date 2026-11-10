import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import AttendanceImportDialog from '../src/components/backComponents/AttendanceImportDialog.vue'
import * as api from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(),
  importAttendanceRecords: vi.fn()
}))

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

const PREVIEW_ROWS = [
  { rowNumber: 2, userId: 'EMP-0006', action: 'clockIn', timestamp: '2024-03-03T23:55:10.000Z', status: 'ready', errors: [], employee: { name: '張雅惠' } },
  { rowNumber: 3, userId: 'EMP-0006', action: 'clockOut', timestamp: '2024-03-04T09:03:20.000Z', status: 'ready', errors: [], employee: { name: '張雅惠' } },
  { rowNumber: 4, userId: 'EMP-0006', action: 'clockIn', timestamp: '2024-03-03T23:55:40.000Z', status: 'duplicate', errors: [], duplicateReason: '檔案中已有同一時間（同一分鐘）的打卡', employee: { name: '張雅惠' } },
  { rowNumber: 5, userId: 'S3-UNKNOWN', action: 'clockIn', timestamp: '2024-03-04T00:00:00.000Z', status: 'missing', errors: [] },
  { rowNumber: 6, userId: 'EMP-0002', action: 'clockIn', timestamp: null, rawTimestamp: '三月五日早上八點', rawAction: '上班簽到', status: 'error', errors: ['無法解析 CHECKTIME：CHECKTIME 格式不支援'] }
]

function previewPayload(overrides = {}) {
  return {
    dryRun: true,
    timezone: 'Asia/Taipei',
    summary: { totalRows: 5, readyCount: 3, missingCount: 1, ignoredCount: 0, errorCount: 1, duplicateCount: 1, importedCount: 0 },
    preview: PREVIEW_ROWS,
    missingUsers: [{ identifier: 'S3-UNKNOWN', count: 1, rows: [5], samples: [] }],
    message: '預覽成功',
    ...overrides
  }
}

function importedPayload(overrides = {}) {
  return {
    dryRun: false,
    timezone: 'Asia/Taipei',
    summary: { totalRows: 5, readyCount: 3, missingCount: 0, ignoredCount: 1, errorCount: 1, duplicateCount: 1, importedCount: 2 },
    preview: PREVIEW_ROWS.map((row) => (row.status === 'missing' ? { ...row, status: 'ignored' } : row)),
    missingUsers: [],
    message: '考勤資料匯入完成（新增 2 筆，重複略過 1 筆）',
    ...overrides
  }
}

describe('AttendanceImportDialog.vue：選擇檔案 → 預覽 → 結果', () => {
  let wrapper

  async function mountDialog() {
    wrapper = mount(AttendanceImportDialog, { props: { modelValue: false }, attachTo: document.body, global: { plugins: [ElementPlus] } })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return wrapper
  }

  const body = (selector) => document.body.querySelector(selector)
  const text = (selector) => (body(selector)?.textContent || '').replace(/\s+/g, ' ').trim()
  // 統計數字之間的空白依排版而定，比對時去掉
  const compact = (selector) => text(selector).replace(/\s+/g, '')

  beforeEach(() => {
    api.apiFetch.mockReset()
    api.importAttendanceRecords.mockReset()
    api.apiFetch.mockImplementation(() => respond([{ _id: 'e1', name: '張雅惠', employeeId: 'EMP-0006' }]))
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'warning').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  // 以前預設是 Asia/Kuala_Lumpur（說明文件與伺服器的預設都是 Asia/Taipei）
  it('第一步只有選檔、時區與欄位對應；時區預設台灣時間並寫在畫面上', async () => {
    await mountDialog()

    expect(body('[data-test="import-step-file"]')).not.toBeNull()
    expect(wrapper.vm.form.timezone).toBe('Asia/Taipei')
    expect(text('[data-test="import-step-file"]')).toContain('台灣時間（Asia/Taipei）')
    expect(text('[data-test="import-mapping-summary"]')).toBe('員工編號「編號」、打卡時間「日期時間」、簽到／簽退「簽到/退」')
    expect([...document.body.querySelectorAll('.el-step__title')].map((el) => el.textContent)).toEqual(['選擇檔案', '預覽與對應', '匯入結果'])
    // 還沒預覽時沒有統計與明細
    expect(body('[data-test="import-summary"]')).toBeNull()

    // 關閉後重新開啟，時區與欄位對應回到預設值
    wrapper.vm.form.timezone = 'UTC'
    wrapper.vm.form.mappings.userId = 'USERID'
    wrapper.vm.visible = false
    await flushPromises()
    expect(wrapper.vm.form.timezone).toBe('Asia/Taipei')
    expect(wrapper.vm.form.mappings.userId).toBe('編號')
  })

  it('預覽顯示可匯入、重複、需對應員工、錯誤的筆數與每一列的原因；沒處理完不能匯入', async () => {
    api.importAttendanceRecords.mockImplementation(() => respond(previewPayload()))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')

    await wrapper.vm.submitPreview()
    await flushPromises()

    expect(wrapper.vm.step).toBe('preview')
    expect(compact('[data-test="import-summary"]')).toBe('共5筆可匯入2筆重複略過1筆需對應員工1筆錯誤1筆')
    const rows = [...document.body.querySelectorAll('.preview-section .el-table__body .el-table__row')].map((row) => row.textContent.replace(/\s+/g, ' '))
    expect(rows).toHaveLength(5)
    expect(rows[0]).toContain('2024/03/04 07:55:10')
    expect(rows[0]).toContain('上班簽到')
    expect(rows[0]).toContain('可匯入')
    expect(rows[2]).toContain('重複略過')
    expect(rows[2]).toContain('張雅惠：檔案中已有同一時間（同一分鐘）的打卡')
    expect(rows[3]).toContain('未對應員工')
    // 讀不懂的時間顯示檔案裡的原文，原因用畫面上的欄位名稱（不是 CHECKTIME）
    expect(rows[4]).toContain('三月五日早上八點')
    expect(rows[4]).toContain('打卡時間格式不支援')
    expect(rows[4]).not.toContain('CHECKTIME')
    expect(text('[data-test="import-step-preview"]')).toContain('時間以台灣時間（Asia/Taipei）顯示')

    expect(text('[data-test="import-blocked-reason"]')).toBe('還有編號沒有對應員工，請選擇員工或勾選「不匯入」')
    expect(body('[data-test="import-submit"]').disabled).toBe(true)
    wrapper.vm.missingResolutions['S3-UNKNOWN'].ignore = true
    await flushPromises()
    expect(body('[data-test="import-blocked-reason"]')).toBeNull()
    expect(body('[data-test="import-submit"]').disabled).toBe(false)
  })

  // 員工編號重複（多位員工用同一個編號）時伺服器在 missingUsers[].reason 說明原因：顯示在「對應員工」選單旁邊
  it('編號對到多位員工時，在對應員工的選單下方顯示伺服器的原因', async () => {
    const reason = '這個員工編號有多位員工使用，請指定要對應的員工'
    api.importAttendanceRecords.mockImplementation(() => respond(previewPayload({
      missingUsers: [
        { identifier: 'EMP-0009', count: 2, rows: [5, 7], samples: [], reason },
        { identifier: 'S3-UNKNOWN', count: 1, rows: [6], samples: [] }
      ]
    })))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')
    await wrapper.vm.submitPreview()
    await flushPromises()

    expect(text('[data-test="import-missing-users"]')).toContain('需要指定員工的編號（2 個）')
    const rows = [...document.body.querySelectorAll('[data-test="import-missing-users"] .el-table__body .el-table__row')]
    expect(rows).toHaveLength(2)
    // 原因和選單在同一格（第三欄「對應員工」），不是放在編號那一格
    const cells = [...rows[0].querySelectorAll('td')]
    expect(cells[0].textContent).not.toContain(reason)
    expect(cells[2].querySelector('.el-select')).not.toBeNull()
    expect(cells[2].querySelector('[data-test="import-missing-reason"]').textContent).toBe(reason)
    // 單純找不到員工的編號沒有額外的原因
    expect(rows[1].querySelector('[data-test="import-missing-reason"]')).toBeNull()
  })

  it('選檔說明寫出支援 Big5 的 CSV 與民國年日期', async () => {
    await mountDialog()
    const tip = text('[data-test="import-file-tip"]')
    expect(tip).toContain('Big5')
    expect(tip).toContain('民國年')
    expect(tip).toContain('最大 5MB')
  })

  // 以前匯入成功就直接關掉對話框，只剩一則幾秒後消失的訊息，看不到哪幾列沒有匯入
  it('匯入後留在結果畫面：新增、重複略過、不匯入、錯誤的筆數與沒匯入的明細，可以下載', async () => {
    api.importAttendanceRecords
      .mockImplementationOnce(() => respond(previewPayload()))
      .mockImplementationOnce(() => respond(importedPayload()))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')
    await wrapper.vm.submitPreview()
    wrapper.vm.missingResolutions['S3-UNKNOWN'].ignore = true

    await wrapper.vm.submitImport()
    await flushPromises()

    expect(wrapper.vm.step).toBe('result')
    expect(wrapper.vm.visible).toBe(true)
    expect(wrapper.emitted('import-complete')).toHaveLength(1)
    expect(text('[data-test="import-result-headline"]')).toBe('已新增 2 筆打卡記錄')
    expect(compact('[data-test="import-summary"]')).toBe('共5筆新增2筆重複略過1筆缺少對應員工0筆不匯入1筆錯誤1筆')
    // 結果的明細預設只列沒匯入的列
    const rows = [...document.body.querySelectorAll('.preview-section .el-table__body .el-table__row')].map((row) => row.textContent.replace(/\s+/g, ' '))
    expect(rows).toHaveLength(3)
    expect(rows.join('|')).toContain('已設定為不匯入')

    const csv = wrapper.vm.buildIssueCsv().split('\r\n')
    expect(csv[0]).toBe('列,編號,時間,動作,狀態,說明')
    expect(csv).toHaveLength(4)
    expect(csv[1]).toBe('4,EMP-0006,2024/03/04 07:55:40,clockIn,重複略過,張雅惠：檔案中已有同一時間（同一分鐘）的打卡')
    expect(csv[3]).toBe('6,EMP-0002,三月五日早上八點,上班簽到,錯誤,打卡時間格式不支援')
    expect(body('[data-test="import-download-issues"]')).not.toBeNull()

    // 「再匯入一個檔案」回到第一步，上一個檔案與結果都清掉
    body('[data-test="import-another"]').click()
    await flushPromises()
    expect(wrapper.vm.step).toBe('file')
    expect(wrapper.vm.selectedFile).toBeNull()
    expect(wrapper.vm.previewState).toBeNull()
  })

  it('匯入中連按兩次只送一次；匯入或預覽進行中不能關閉對話框', async () => {
    let resolveImport
    api.importAttendanceRecords
      .mockImplementationOnce(() => respond(previewPayload({ missingUsers: [], summary: { totalRows: 3, readyCount: 3, missingCount: 0, ignoredCount: 0, errorCount: 0, duplicateCount: 0, importedCount: 0 } })))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveImport = () => resolve({ ok: true, status: 200, json: async () => importedPayload() }) }))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'.repeat(200 * 1024)], 'punch-big.csv')
    await wrapper.vm.submitPreview()

    const first = wrapper.vm.submitImport()
    const second = wrapper.vm.submitImport()
    // 匯入中再按「預覽」也不會送
    const third = wrapper.vm.submitPreview()
    await flushPromises()
    expect(api.importAttendanceRecords).toHaveBeenCalledTimes(2)
    expect(text('[data-test="import-progress"]')).toContain('匯入中（200 KB）')
    expect(body('.el-dialog__headerbtn')).toBeNull()

    resolveImport()
    await Promise.all([first, second, third])
    await flushPromises()
    expect(body('[data-test="import-progress"]')).toBeNull()
    expect(wrapper.vm.step).toBe('result')
  })

  it('重複匯入同一個檔案：預覽就說明沒有新的資料，不能按開始匯入', async () => {
    api.importAttendanceRecords.mockImplementation(() => respond(previewPayload({
      missingUsers: [],
      summary: { totalRows: 3, readyCount: 3, missingCount: 0, ignoredCount: 0, errorCount: 0, duplicateCount: 3, importedCount: 0 }
    })))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')

    await wrapper.vm.submitPreview()
    await flushPromises()

    expect(compact('[data-test="import-summary-new"]')).toBe('可匯入0筆')
    expect(text('[data-test="import-blocked-reason"]')).toBe('沒有新的打卡資料可以匯入')
    expect(body('[data-test="import-submit"]').disabled).toBe(true)
  })

  // 伺服器的訊息已經帶著原因時，以前會再接一次（「所有資料均未匯入：1 筆資料缺少對應員工：1 筆資料缺少對應員工」）
  it('匯入失敗的訊息不重複原因；讀不到檔案時帶出伺服器說明的細節', async () => {
    api.importAttendanceRecords
      .mockImplementationOnce(() => respond({ message: '匯入檔案缺少必要欄位', errors: ['找不到欄位：編號', '找不到欄位：日期時間'] }, false, 400))
      .mockImplementationOnce(() => respond(previewPayload()))
      .mockImplementationOnce(() => respond({
        ...previewPayload({ dryRun: false, preview: [] }),
        message: '所有資料均未匯入：1 筆資料缺少對應員工',
        failureReasons: ['1 筆資料缺少對應員工']
      }, false, 400))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')

    await wrapper.vm.submitPreview()
    expect(ElMessage.error).toHaveBeenCalledWith('匯入檔案缺少必要欄位：找不到欄位：編號、找不到欄位：日期時間')
    expect(wrapper.vm.step).toBe('file')

    await wrapper.vm.submitPreview()
    wrapper.vm.missingResolutions['S3-UNKNOWN'].ignore = true
    await wrapper.vm.submitImport()
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('所有資料均未匯入：1 筆資料缺少對應員工')
    expect(wrapper.vm.step).toBe('preview')
    expect(wrapper.emitted('import-complete')).toBeUndefined()
  })

  // 中途寫入失敗時伺服器只回部分統計（沒有明細）；以前會拿它蓋掉整個預覽，畫面上的筆數變成空白
  it('寫入失敗（500）時保留原本的預覽，並顯示伺服器說明已新增幾筆', async () => {
    api.importAttendanceRecords
      .mockImplementationOnce(() => respond(previewPayload({ missingUsers: [] })))
      .mockImplementationOnce(() => respond({ message: '考勤資料寫入失敗：已新增 500 筆，其餘尚未匯入；請稍後用同一個檔案再匯入一次（已有的打卡會自動略過）', errors: [], summary: { importedCount: 500, duplicateCount: 0 } }, false, 500))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')
    await wrapper.vm.submitPreview()

    await wrapper.vm.submitImport()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('已新增 500 筆，其餘尚未匯入'))
    expect(wrapper.vm.previewState.summary.totalRows).toBe(5)
    expect(wrapper.vm.previewState.preview).toHaveLength(5)
    expect(wrapper.vm.step).toBe('preview')
  })

  it('換了檔案就清掉上一個檔案的預覽與員工對應；明細被截斷時說明統計是整個檔案', async () => {
    const preview = Array.from({ length: 50 }, (_, index) => ({ ...PREVIEW_ROWS[0], rowNumber: index + 2 }))
    api.importAttendanceRecords.mockImplementation(() => respond(previewPayload({
      preview,
      summary: { totalRows: 3000, readyCount: 3000, missingCount: 0, ignoredCount: 0, errorCount: 0, duplicateCount: 0, importedCount: 0 }
    })))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')
    await wrapper.vm.submitPreview()
    await flushPromises()
    expect(text('[data-test="import-step-preview"]')).toContain('明細只列出檔案的前 50 筆，統計數字是整個檔案')
    expect(Object.keys(wrapper.vm.missingResolutions)).toEqual(['S3-UNKNOWN'])

    body('[data-test="import-back"]').click()
    await flushPromises()
    expect(wrapper.vm.step).toBe('file')
    // 回到第一步，原本選的檔案還在
    expect(text('[data-test="import-file-tip"]')).toContain('已選擇：punch.csv')
    wrapper.findComponent({ name: 'ElUpload' }).vm.$emit('change', { raw: new File(['y'], 'other.xlsx') })
    await flushPromises()
    expect(wrapper.vm.selectedFile.name).toBe('other.xlsx')
    expect(wrapper.vm.previewState).toBeNull()
    expect(Object.keys(wrapper.vm.missingResolutions)).toEqual([])
  })

  // 以前「只看沒匯入的」與下載的 CSV 只有預覽的前 50 列：第 51 列之後的錯誤看不到。伺服器現在回傳整個檔案的 issues
  it('「只看沒匯入的」與下載的明細用伺服器的 issues（整個檔案），超過上限時說明只列出前幾筆', async () => {
    const lateError = { rowNumber: 120, userId: 'EMP-0003', action: '', timestamp: null, rawTimestamp: '2026-02-30 08:00', rawAction: 'I', status: 'error', errors: ['打卡時間的日期或時間超出範圍：「2026-02-30 08:00」'] }
    const issues = [PREVIEW_ROWS[2], PREVIEW_ROWS[3], PREVIEW_ROWS[4], lateError]
    api.importAttendanceRecords.mockImplementation(() => respond(previewPayload({ issues, issueCount: 6000, issuesTruncated: true })))
    await mountDialog()
    wrapper.vm.selectedFile = new File(['x'], 'punch.csv')
    await wrapper.vm.submitPreview()
    await flushPromises()

    expect(text('[data-test="import-filter-issues"]')).toBe('只看沒匯入的（6000）')
    wrapper.vm.statusFilter = 'issues'
    await flushPromises()
    const rows = [...document.body.querySelectorAll('.preview-section .el-table__body .el-table__row')].map((row) => row.textContent.replace(/\s+/g, ' '))
    expect(rows).toHaveLength(4)
    expect(rows[3]).toContain('120')
    expect(rows[3]).toContain('打卡時間的日期或時間超出範圍')
    expect(text('[data-test="import-step-preview"]')).toContain('沒匯入的資料只列出前 4 筆（共 6000 筆）')
    expect(wrapper.vm.buildIssueCsv().split('\r\n')).toHaveLength(5)
  })
})
