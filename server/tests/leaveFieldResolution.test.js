import { resolveLeaveFieldsForRequest } from '../src/utils/leaveFieldResolution.js'

// 欄位被停用或換成同標籤的新欄位後，每張假單各自挑第一個有填值的欄位（啟用中的在前、停用的在後）
describe('resolveLeaveFieldsForRequest', () => {
  const leaveFields = {
    formId: 'form1',
    isActive: true,
    typeId: 'n-type',
    startId: 'n-start',
    endId: 'n-end',
    daysId: 'n-days',
    typeIds: ['n-type', 'o-type'],
    startIds: ['n-start', 'o-start'],
    endIds: ['n-end', 'o-end'],
    daysIds: ['n-days', 'o-days'],
    typeOptions: [{ value: '特休', label: '特休' }],
  }

  it('takes the first candidate that holds a value, per field', () => {
    const resolved = resolveLeaveFieldsForRequest(leaveFields, {
      'o-type': '特休',
      'o-start': '2026-03-02',
      'n-end': '2026-03-03',
      'o-days': 2,
    })

    expect(resolved).toMatchObject({ typeId: 'o-type', startId: 'o-start', endId: 'n-end', daysId: 'o-days' })
  })

  it('prefers the active field when both hold a value', () => {
    const resolved = resolveLeaveFieldsForRequest(leaveFields, { 'n-type': '病假', 'o-type': '特休' })

    expect(resolved.typeId).toBe('n-type')
  })

  it('treats blank answers as no value, but keeps 0 and false', () => {
    const resolved = resolveLeaveFieldsForRequest(leaveFields, {
      'n-type': '  ',
      'o-type': '特休',
      'n-days': [],
      'o-days': 0,
    })

    expect(resolved).toMatchObject({ typeId: 'o-type', daysId: 'o-days' })
  })

  it('falls back to the active field when no candidate holds a value (same as reading a single field)', () => {
    const resolved = resolveLeaveFieldsForRequest(leaveFields, {})

    expect(resolved).toMatchObject({ typeId: 'n-type', startId: 'n-start', endId: 'n-end', daysId: 'n-days' })
  })

  it('keeps every other property (form id, type options) untouched', () => {
    const resolved = resolveLeaveFieldsForRequest(leaveFields, { 'o-type': '特休' })

    expect(resolved.formId).toBe('form1')
    expect(resolved.typeOptions).toBe(leaveFields.typeOptions)
    expect(leaveFields.typeId).toBe('n-type') // 不改動傳入的物件
  })

  it('works with only single ids (no candidate lists) and with missing input', () => {
    const single = { typeId: 'f-type', startId: 'f-start', endId: 'f-end' }

    expect(resolveLeaveFieldsForRequest(single, { 'f-type': '特休' })).toMatchObject({ typeId: 'f-type', startId: 'f-start', endId: 'f-end' })
    expect(resolveLeaveFieldsForRequest(undefined, undefined)).toMatchObject({ typeId: undefined, startId: undefined })
    expect(resolveLeaveFieldsForRequest({}, null)).toMatchObject({ typeId: undefined, daysId: undefined })
  })
})
