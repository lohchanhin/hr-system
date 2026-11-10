import { formatSummaryValue } from '../src/services/approvalListSummary.js'

// 單一勾選欄位（例如「是否跨日」）存的是 true/false：清單摘要要顯示 是／否，不能出現 true / false
describe('formatSummaryValue boolean answers', () => {
  const field = { type_1: 'checkbox', label: '是否跨日', options: [] }

  it('shows 是 for true and 否 for false', () => {
    expect(formatSummaryValue(field, true)).toBe('是')
    expect(formatSummaryValue(field, false)).toBe('否')
  })

  it('keeps option labels for non-boolean answers', () => {
    const select = { type_1: 'select', label: '假別', options: [{ value: 'a', label: '事假' }] }
    expect(formatSummaryValue(select, 'a')).toBe('事假')
  })
})
