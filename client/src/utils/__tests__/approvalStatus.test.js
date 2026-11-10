import { describe, it, expect } from 'vitest'
import { approvalStatusTagType, approvalStatusText } from '../approvalStatus'
import { getStatusTagType, getStatusText } from '../approvalDetail'
import { describeUsage } from '../compensatoryLeave'

// 申請單的狀態在簽核頁、排班頁的「相關簽核」、調休存摺都會出現：文字與顏色只能有一套
describe('申請單狀態的文字與標籤顏色（全站共用）', () => {
  it('每個狀態一種說法、一種顏色', () => {
    expect(['pending', 'approved', 'rejected', 'returned', 'canceled', 'skipped'].map(approvalStatusText))
      .toEqual(['待簽核', '已核可', '已否決', '已退簽', '已撤回', '已由其他人處理'])
    expect(['pending', 'approved', 'rejected', 'returned', 'canceled', 'skipped'].map(approvalStatusTagType))
      .toEqual(['warning', 'success', 'danger', 'primary', 'info', 'info'])
  })

  it('cancelled（舊拼法）和 canceled 相同；不認得的狀態照原樣顯示、用灰色', () => {
    expect(approvalStatusText('cancelled')).toBe('已撤回')
    expect(approvalStatusTagType('cancelled')).toBe('info')
    expect(approvalStatusText('archived')).toBe('archived')
    expect(approvalStatusTagType('archived')).toBe('info')
    expect(approvalStatusText('')).toBe('-')
  })

  it('簽核頁的明細工具與調休存摺的使用紀錄用的是同一份', () => {
    for (const status of ['pending', 'approved', 'rejected', 'returned', 'canceled']) {
      expect(getStatusText(status)).toBe(approvalStatusText(status))
      expect(getStatusTagType(status)).toBe(approvalStatusTagType(status))
    }
    const usage = { kind: 'leave_request', hours: 8, date: '2026-10-26', wholeDay: true, approvalStatus: 'returned' }
    expect(describeUsage(usage)).toContain('已退簽')
    expect(describeUsage({ ...usage, approvalStatus: 'pending' })).toContain('待簽核')
  })
})
