import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  actionLabel,
  attachmentDisplayName,
  attachmentFilename,
  attachmentItems,
  buildLogRows,
  detailFields,
  downloadApprovalAttachment,
  findReturnInfo,
  getStatusTagType,
  getStatusText,
} from '../src/utils/approvalDetail'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('approvalDetail 狀態文字', () => {
  it('狀態與決議都有中文', () => {
    expect(getStatusText('returned')).toBe('已退簽')
    expect(getStatusText('skipped')).toBe('已由其他人處理')
    expect(getStatusText('')).toBe('-')
    expect(getStatusText(undefined)).toBe('-')
    expect(getStatusTagType('approved')).toBe('success')
    expect(getStatusTagType('whatever')).toBe('info')
  })
})

describe('approvalDetail 退簽原因 findReturnInfo', () => {
  const returnedDoc = (logs, extra = {}) => ({ status: 'returned', logs, steps: [], ...extra })

  it('不是退簽狀態時沒有退簽資訊', () => {
    expect(findReturnInfo({ status: 'pending', logs: [{ action: 'return', comment: 'x' }] })).toBeNull()
    expect(findReturnInfo(null)).toBeNull()
  })

  it('優先使用伺服器整理好的 last_return', () => {
    const info = findReturnInfo(returnedDoc([], {
      last_return: {
        at: '2026-06-19T02:00:00.000Z',
        by: { _id: 'u2', name: 'Alice' },
        comment: '用途請寫清楚',
        message: '退回申請者：用途請寫清楚',
      },
    }))
    expect(info).toEqual({ by: 'Alice', message: '用途請寫清楚', time: '2026/06/19 10:00' })
  })

  it('沒有 comment 時，從 message 去掉系統前綴；只有系統前綴代表沒寫原因', () => {
    const withReason = findReturnInfo(returnedDoc([
      { action: 'return', by_employee: { name: 'Alice' }, message: '退回申請者：日期有誤', at: '2026-06-19T02:00:00.000Z' },
    ]))
    expect(withReason.message).toBe('日期有誤')
    const without = findReturnInfo(returnedDoc([
      { action: 'return', by_employee: { name: 'Alice' }, message: '退回申請者', at: '2026-06-19T02:00:00.000Z' },
    ]))
    expect(without.message).toBe('')
    const toStep = findReturnInfo(returnedDoc([{ action: 'return', message: '退回到第 2 關' }]))
    expect(toStep.message).toBe('')
  })

  it('取最後一筆退簽紀錄，也認得管理員代為退簽', () => {
    const info = findReturnInfo(returnedDoc([
      { action: 'return', comment: '第一次退簽', by_employee: { name: 'Alice' } },
      { action: 'resubmit' },
      { action: 'admin_override', decision: 'return', comment: '管理員退簽', message: '管理員代為退簽第 1 關：管理員退簽', by_employee: { name: '管理員' } },
    ]))
    expect(info.message).toBe('管理員退簽')
    expect(info.by).toBe('管理員')
  })

  it('紀錄沒有原因時，退而使用簽核人的退簽意見與員工名稱快取', () => {
    const info = findReturnInfo(returnedDoc(
      [{ action: 'return', by_employee: 'u2', message: '退回申請者' }],
      { steps: [{ approvers: [{ approver: { _id: 'u2', name: 'Alice' }, decision: 'returned', comment: '請補證明', decided_at: '2026-06-19T02:00:00.000Z' }] }] },
    ), id => ({ u2: '快取名' })[id])
    expect(info.message).toBe('請補證明')
    expect(info.by).toBe('快取名')
  })
})

describe('approvalDetail 簽核紀錄與欄位', () => {
  it('簽核紀錄列用台灣時間與中文動作；找不到人名時顯示系統', () => {
    const rows = buildLogRows({
      logs: [
        { action: 'create', at: '2026-06-19T00:00:00.000Z', message: '建立送審單' },
        { action: 'approve', at: '2026-06-19T01:30:00.000Z', by_employee: { _id: 'u2', name: 'Alice' } },
        { action: 'admin_override', by_employee: 'u9', message: '管理員代為核可第 1 關' },
        { action: 'mystery' },
      ],
    }, id => ({ u9: '管理員' })[id])
    expect(rows.map(r => [r.time, r.actor, r.action])).toEqual([
      ['2026/06/19 08:00', '系統', '送出申請'],
      ['2026/06/19 09:30', 'Alice', '核可'],
      ['-', '管理員', '管理員代為處理'],
      ['-', '系統', 'mystery'],
    ])
    expect(actionLabel('')).toBe('-')
  })

  it('伺服器會寫進簽核紀錄的每一種動作都有中文名稱（自動略過、特休扣減不顯示英文代碼）', () => {
    const labels = {
      create: '送出申請',
      approve: '核可',
      reject: '否決',
      return: '退簽',
      resubmit: '重新送出',
      cancel: '撤回',
      move_next: '進入下一關',
      skip: '自動略過',
      finish: '流程完成',
      admin_override: '管理員代為處理',
      annual_leave: '特休扣減',
      annual_leave_error: '特休扣減失敗',
    }
    for (const [action, label] of Object.entries(labels)) expect(actionLabel(action)).toBe(label)
    const rows = buildLogRows({
      logs: [
        { action: 'skip', message: '第 2 關沒有簽核人，已自動略過' },
        { action: 'annual_leave', message: '已扣除特休 1 天' },
        { action: 'annual_leave_error', message: '特休餘額不足' },
      ],
    })
    expect(rows.map(row => row.action)).toEqual(['自動略過', '特休扣減', '特休扣減失敗'])
  })

  // 伺服器之後新增動作卻忘了補中文名稱，這個測試會直接指出是哪一個
  const serverSourceDir = resolve(process.cwd(), '../server/src')
  const logActionSources = ['controllers/approvalRequestController.js', 'services/approvalRequestEngine.js']
    .map(file => resolve(serverSourceDir, file))
  it.skipIf(!logActionSources.every(file => existsSync(file)))(
    '伺服器程式裡寫入簽核紀錄的動作都已有標籤',
    () => {
      const actions = new Set()
      for (const file of logActionSources) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(/\baction:\s*'([a-z_]+)'/g)) actions.add(match[1])
      }
      expect(actions.size).toBeGreaterThanOrEqual(12)
      const unlabelled = [...actions].filter(action => actionLabel(action) === action)
      expect(unlabelled).toEqual([])
    },
  )

  it('明細欄位包含已刪除欄位留下的資料，已停用但沒有資料的欄位不列', () => {
    const fields = detailFields({
      form: { fields: [
        { _id: 'a', label: '事由' },
        { _id: 'b', label: '停用有資料', is_active: false },
        { _id: 'c', label: '停用沒資料', is_active: false },
      ] },
      form_data: { a: '', b: 'x', orphan: '舊資料', emptyOrphan: '' },
    })
    expect(fields.map(f => f.label)).toEqual(['事由', '停用有資料', '（已移除的欄位）'])
    expect(fields[2]._id).toBe('orphan')
  })

  it('附件名稱與檔名', () => {
    const file = { name: 'C:\\fake\\proof.pdf', url: '/upload/approvals/gen-1.pdf?x=1' }
    expect(attachmentItems([file, '文字', null, { name: 'no url' }])).toEqual([file])
    expect(attachmentFilename(file)).toBe('gen-1.pdf')
    expect(attachmentDisplayName(file)).toBe('proof.pdf')
    expect(attachmentDisplayName({ url: '/upload/approvals/g.pdf' })).toBe('g.pdf')
    expect(attachmentDisplayName({})).toBe('附件')
  })
})

describe('approvalDetail 附件下載', () => {
  it('沒有單號或檔名時不發出請求', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch')
    expect(await downloadApprovalAttachment('', { url: '/upload/approvals/x.pdf' })).toBe(false)
    expect(await downloadApprovalAttachment('a1', {})).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
