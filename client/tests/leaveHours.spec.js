import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import {
  estimateLeaveHours,
  floorToStep,
  isLeaveHoursLabel,
  maxHoursOfInterval,
  parseLeaveInterval,
  pickLeaveFormFields,
  splitLeaveByDay,
  toTaipeiDateKey,
} from '../src/utils/leaveHours'
import { useLeaveHoursAutofill } from '../src/utils/useLeaveHoursAutofill'

// 與伺服器 tests/leaveHours.test.js 的 maxHoursOfInterval 同一組案例：前端的換算必須和伺服器一模一樣
const tw = (day, time) => `2026-03-${day}T${time}:00+08:00`
const maxOf = (start, end, options, perDay) => maxHoursOfInterval(parseLeaveInterval(start, end, options), perDay)

describe('estimateLeaveHours / maxHoursOfInterval (same maths as the server)', () => {
  it('counts the real hours of a timed leave and caps every Taiwan day at the per-day maximum', () => {
    expect(maxOf(tw('02', '09:00'), tw('02', '13:00'))).toBe(4)
    expect(maxOf(tw('02', '07:00'), tw('02', '19:00'))).toBe(8)
    expect(maxOf(tw('02', '07:00'), tw('02', '19:00'), {}, 12)).toBe(12)
    expect(maxOf(tw('02', '23:00'), tw('03', '07:00'))).toBe(8)
  })

  it('gives whole days the full per-day maximum, inclusive of both ends', () => {
    expect(maxOf('2026-07-01', '2026-07-02')).toBe(16)
    expect(maxOf('2026-07-01', '2026-07-01', {}, 12)).toBe(12)
  })

  it('is zero for a missing or reversed interval', () => {
    expect(maxHoursOfInterval(null)).toBe(0)
    expect(maxOf('2026-07-05', '2026-07-01')).toBe(0)
  })

  it('splits an overnight leave over the two Taiwan days it touches', () => {
    const interval = parseLeaveInterval(tw('02', '23:00'), tw('03', '07:00'))
    expect(splitLeaveByDay(interval)).toEqual([{ dateKey: '2026-03-02', hours: 1 }, { dateKey: '2026-03-03', hours: 7 }])
  })

  it('treats the date picker\'s Taiwan midnight (stored as UTC the day before) as a whole day, also when both fields are typed date', () => {
    expect(maxOf('2026-03-01T16:00:00.000Z', '2026-03-02T16:00:00.000Z')).toBe(16)
    expect(maxOf(new Date('2026-03-01T16:00:00.000Z'), new Date('2026-03-01T16:00:00.000Z'), { startType: 'date', endType: 'date' })).toBe(8)
  })

  it('reads Date objects, ISO text and date-only text the same way', () => {
    expect(toTaipeiDateKey(new Date('2026-03-01T16:00:00.000Z'))).toBe('2026-03-02')
    expect(toTaipeiDateKey('2026/3/2')).toBe('2026-03-02')
    expect(toTaipeiDateKey('2026-02-31')).toBeNull()
    expect(toTaipeiDateKey('')).toBeNull()
    expect(toTaipeiDateKey('nonsense')).toBeNull()
  })

  it('suggests the maximum floored to the minimum unit and tells apart an unreadable and a reversed range', () => {
    expect(estimateLeaveHours(tw('02', '09:00'), tw('02', '13:00'))).toMatchObject({ valid: true, allDay: false, maxHours: 4, suggestedHours: 4 })
    expect(estimateLeaveHours(tw('02', '09:00'), tw('02', '12:20'))).toMatchObject({ valid: true, maxHours: 3.3333, suggestedHours: 3 })
    expect(estimateLeaveHours('2026-03-05', '2026-03-02')).toMatchObject({ valid: false, reversed: true, suggestedHours: 0 })
    expect(estimateLeaveHours('', '2026-03-02')).toMatchObject({ valid: false, reversed: false })
    expect(floorToStep(7.99, 0.5)).toBe(7.5)
    expect(floorToStep(7.99, 1)).toBe(7)
  })
})

describe('leave form field recognition (same labels as the server)', () => {
  it('recognises the hours labels loosely', () => {
    for (const label of ['時數', '請假時數', '小時', ' 小時數 ', '請假時數（小時）']) expect(isLeaveHoursLabel(label)).toBe(true)
    for (const label of ['天數', '日期(起)', '事由', '假別']) expect(isLeaveHoursLabel(label)).toBe(false)
  })

  it('picks the leave fields of a form, preferring the active one of the same label', () => {
    const picked = pickLeaveFormFields([
      { _id: 'type', label: '假別類別 (C12)', order: 1 },
      { _id: 's', label: '日期(起)', order: 2 },
      { _id: 'e', label: '日期(迄)', order: 3 },
      { _id: 'old', label: '時數', order: 4, is_active: false },
      { _id: 'new', label: '時數', order: 5 },
      { _id: 'days', label: '天數', order: 6, is_active: false },
    ])
    expect(picked.typeField._id).toBe('type')
    expect(picked.startField._id).toBe('s')
    expect(picked.endField._id).toBe('e')
    expect(picked.hoursField._id).toBe('new')
    expect(picked.daysField._id).toBe('days')
  })
})

describe('useLeaveHoursAutofill', () => {
  afterEach(() => vi.useRealTimers())

  const fields = [
    { _id: 'type', label: '假別', type_1: 'select', order: 1 },
    { _id: 'start', label: '開始時間', type_1: 'datetime', order: 2 },
    { _id: 'end', label: '結束時間', type_1: 'datetime', order: 3 },
    { _id: 'hours', label: '時數', type_1: 'number', order: 4 },
  ]

  function setup(overrides = {}) {
    const state = reactive({ data: { type: '', start: '', end: '', hours: null } })
    const fieldRef = ref(fields)
    const api = useLeaveHoursAutofill({
      fields: fieldRef,
      getFormData: () => state.data,
      setValue: (id, value) => { state.data = { ...state.data, [id]: value } },
      ...overrides,
    })
    const set = async (patch) => { state.data = { ...state.data, ...patch }; await nextTick() }
    return { state, api, set, fieldRef }
  }

  it('fills the hours when both times are known and follows them while the hours were not touched', async () => {
    const { state, set } = setup()
    await set({ start: tw('02', '09:00') })
    expect(state.data.hours).toBeNull() // 只有開始時間，算不出來

    await set({ end: tw('02', '13:00') })
    expect(state.data.hours).toBe(4)

    await set({ end: tw('02', '18:00') }) // 還是自動帶入的值：跟著改
    expect(state.data.hours).toBe(8)
  })

  it('never overwrites hours the applicant typed', async () => {
    const { state, set } = setup()
    await set({ start: tw('02', '09:00'), end: tw('02', '13:00') })
    expect(state.data.hours).toBe(4)

    await set({ hours: 2.5 }) // 申請人自己改成 2.5
    await set({ end: tw('02', '18:00') })
    expect(state.data.hours).toBe(2.5)
  })

  it('clears an auto-filled value when the range becomes unreadable or reversed, but keeps typed hours', async () => {
    const { state, set } = setup()
    await set({ start: tw('02', '09:00'), end: tw('02', '13:00') })
    await set({ end: tw('02', '08:00') }) // 結束早於開始
    expect(state.data.hours).toBeNull()

    await set({ end: tw('02', '13:00') })
    expect(state.data.hours).toBe(4)
    await set({ hours: 3 })
    await set({ end: tw('02', '08:00') })
    expect(state.data.hours).toBe(3)
  })

  it('keeps hours that are already in a form being edited (a returned request)', async () => {
    const state = reactive({ data: { start: tw('02', '09:00'), end: tw('02', '13:00'), hours: 3 } })
    useLeaveHoursAutofill({
      fields,
      getFormData: () => state.data,
      setValue: (id, value) => { state.data = { ...state.data, [id]: value } },
    })
    await nextTick()
    expect(state.data.hours).toBe(3)
  })

  it('exposes the maximum for the hours input once the range is readable, using the daily maximum of the policy', async () => {
    const { api, set } = setup({ getPolicy: () => ({ maxHoursPerDay: 12, minUnitHours: 1 }) })
    expect(api.maxHours.value).toBeUndefined()
    await set({ start: '2026-03-02', end: '2026-03-03' })
    expect(api.maxHours.value).toBe(24)
    await set({ start: tw('02', '07:00'), end: tw('02', '19:00') })
    expect(api.maxHours.value).toBe(12)
  })

  it('does nothing for a form that has no hours field', async () => {
    const state = reactive({ data: { start: tw('02', '09:00'), end: tw('02', '13:00') } })
    const setValue = vi.fn()
    const api = useLeaveHoursAutofill({
      fields: fields.filter(field => field._id !== 'hours'),
      getFormData: () => state.data,
      setValue,
    })
    await nextTick()
    expect(api.enabled.value).toBe(false)
    expect(setValue).not.toHaveBeenCalled()
  })

  it('refines the suggestion with the schedule from the server (12-hour shift, rest day) after the times stop changing, and ignores stale answers', async () => {
    vi.useFakeTimers()
    const answers = []
    const fetchHint = vi.fn((start, end) => new Promise((resolve) => { answers.push({ start, end, resolve }) }))
    const { state, api, set } = setup({ fetchHint, hintDelayMs: 100 })

    await set({ start: '2026-03-02', end: '2026-03-03' })
    expect(state.data.hours).toBe(16) // 先用本機的估算
    expect(fetchHint).not.toHaveBeenCalled()

    vi.advanceTimersByTime(120)
    expect(fetchHint).toHaveBeenCalledTimes(1)
    answers[0].resolve({ valid: true, maxHours: 20, suggestedHours: 12 })
    await vi.runAllTicks()
    await nextTick()
    await nextTick()
    expect(state.data.hours).toBe(12) // 沒動過的值改成依班表算出的
    expect(api.maxHours.value).toBe(20)

    // 改了日期：舊的班表結果作廢，晚到的舊答案不能蓋掉新的
    await set({ end: '2026-03-04' })
    vi.advanceTimersByTime(120)
    expect(fetchHint).toHaveBeenCalledTimes(2)
    await set({ end: '2026-03-05' })
    vi.advanceTimersByTime(120)
    expect(fetchHint).toHaveBeenCalledTimes(3)
    answers[1].resolve({ valid: true, maxHours: 99, suggestedHours: 99 }) // 第二次的答案晚到
    answers[2].resolve({ valid: true, maxHours: 32, suggestedHours: 32 })
    await nextTick()
    await nextTick()
    expect(api.maxHours.value).toBe(32)
    expect(state.data.hours).toBe(32)
  })

  it('keeps the local estimate when the server cannot answer', async () => {
    vi.useFakeTimers()
    const fetchHint = vi.fn(() => Promise.reject(new Error('offline')))
    const { state, api, set } = setup({ fetchHint, hintDelayMs: 10 })
    await set({ start: '2026-03-02', end: '2026-03-02' })
    vi.advanceTimersByTime(20)
    await nextTick()
    await nextTick()
    expect(state.data.hours).toBe(8)
    expect(api.maxHours.value).toBe(8)
  })
})
