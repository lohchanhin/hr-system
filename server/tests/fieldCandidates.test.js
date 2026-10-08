import { describe, it, expect } from '@jest/globals'
import {
  candidateSelectKeys,
  hasFieldValue,
  orderFieldCandidateIds,
  pickFieldValue,
  resolveCandidateIds,
} from '../src/utils/fieldCandidates.js'
import { approvedInMonthFilter, payrollMonthRange } from '../src/utils/payrollMonth.js'

// 同標籤欄位的候選規則：欄位被停用或換成同標籤的新欄位後，舊單據的答案還在舊欄位 ID 底下

describe('hasFieldValue', () => {
  it('treats empty answers as missing but keeps 0 and false', () => {
    for (const empty of [undefined, null, '', '   ', []]) expect(hasFieldValue(empty)).toBe(false)
    for (const filled of [0, false, '0', 'x', ['a'], { label: '特休' }, new Date()]) expect(hasFieldValue(filled)).toBe(true)
  })
})

describe('orderFieldCandidateIds', () => {
  it('puts active fields first and inactive ones last, each by order, and ignores fields without an id', () => {
    const ids = orderFieldCandidateIds([
      { _id: 'old', order: 1, is_active: false },
      { _id: 'newer', order: 5 },
      { _id: 'new', order: 3, is_active: true },
      { order: 0 },
      { _id: 'older', order: 0, is_active: false },
    ])

    expect(ids).toEqual(['new', 'newer', 'older', 'old'])
  })

  it('keeps the original order when the order values are equal and accepts ObjectId-like ids', () => {
    const objectIdLike = { toString: () => 'abc123' }

    expect(orderFieldCandidateIds([{ _id: 'b' }, { _id: objectIdLike }, { _id: 'a' }])).toEqual(['b', 'abc123', 'a'])
    expect(orderFieldCandidateIds(undefined)).toEqual([])
  })
})

describe('pickFieldValue', () => {
  it('uses the first candidate that has an answer in this request', () => {
    expect(pickFieldValue({ old: '2026-11-02', fresh: '' }, ['fresh', 'old'])).toBe('2026-11-02')
    expect(pickFieldValue({ old: '2026-11-02', fresh: '2026-12-01' }, ['fresh', 'old'])).toBe('2026-12-01')
    expect(pickFieldValue({ fresh: 0 }, ['fresh', 'old'])).toBe(0)
  })

  it('returns undefined when no candidate was answered or there is no form data', () => {
    expect(pickFieldValue({ other: 'x' }, ['fresh', 'old'])).toBeUndefined()
    expect(pickFieldValue(null, ['fresh'])).toBeUndefined()
    expect(pickFieldValue({ fresh: 'x' }, undefined)).toBeUndefined()
  })
})

describe('resolveCandidateIds / candidateSelectKeys', () => {
  it('falls back to the single field id when the caller has no candidate list', () => {
    expect(resolveCandidateIds(['a', 'b'], 'a')).toEqual(['a', 'b'])
    expect(resolveCandidateIds(undefined, 'a')).toEqual(['a'])
    expect(resolveCandidateIds([], undefined)).toEqual([])
  })

  it('lists every candidate once for the query projection', () => {
    expect(candidateSelectKeys(['s2', 's1'], ['e1'], ['s1', 't1'], undefined)).toEqual(['s2', 's1', 'e1', 't1'])
  })
})

describe('payrollMonthRange', () => {
  it('covers the whole Taipei month, not the UTC month', () => {
    const range = payrollMonthRange('2026-07-01')

    expect(range.start.toISOString()).toBe('2026-06-30T16:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-07-31T16:00:00.000Z')
  })

  it('handles December and invalid input', () => {
    expect(payrollMonthRange(new Date('2026-12-01T00:00:00.000Z')).end.toISOString()).toBe('2026-12-31T16:00:00.000Z')
    expect(payrollMonthRange('not a month')).toBeNull()
  })
})

describe('approvedInMonthFilter', () => {
  it('selects approved requests by completion, not by the month they were filed in', () => {
    const range = payrollMonthRange('2026-07-01')
    const filter = approvedInMonthFilter(range)

    expect(filter.status).toBe('approved')
    // 送簽早於月底即可（上個月送簽、這個月才核准的也要算）
    expect(filter.createdAt).toEqual({ $lt: range.end })
    expect(filter.createdAt).not.toHaveProperty('$gte')
    // 更新時間一定不早於核准完成時間，月初前一天當下限
    expect(filter.updatedAt.$gte.toISOString()).toBe('2026-06-29T16:00:00.000Z')
  })
})
