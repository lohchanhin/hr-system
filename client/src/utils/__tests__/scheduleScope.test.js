import { describe, it, expect } from 'vitest'
import {
  filterScopeDepartments,
  filterScopeSubDepartments,
  isNonWorkShift,
  normalizeScheduleAccess,
  resolveAllowedShiftIds,
  restrictShifts
} from '../scheduleScope'

const departments = [
  { _id: 'dA', name: 'A 部門' },
  { _id: 'dB', name: 'B 部門' },
  { _id: 'dC', name: 'C 部門' }
]
const units = [
  { _id: 'uA1', name: 'A1', department: 'dA', allowedShiftIds: [] },
  { _id: 'uA2', name: 'A2', department: 'dA', allowedShiftIds: ['day', 'rest'] },
  { _id: 'uB1', name: 'B1', department: 'dB', allowedShiftIds: ['night'] },
  { _id: 'uC1', name: 'C1', department: 'dC' }
]
const shifts = [
  { _id: 'day', code: 'D' },
  { _id: 'night', code: 'N' },
  { _id: 'rest', code: '休' }
]

describe('normalizeScheduleAccess', () => {
  it('returns null without data so the page keeps the role rules', () => {
    expect(normalizeScheduleAccess(null)).toBeNull()
    expect(normalizeScheduleAccess([])).toBeNull()
  })

  it('normalises ids and tells whether the user is a scheduler', () => {
    expect(normalizeScheduleAccess({ canSchedule: true, subDepartmentIds: ['uA1'], departmentIds: ['dA'] })).toEqual({
      canSchedule: true,
      supervisorScope: false,
      subDepartmentIds: ['uA1'],
      departmentIds: ['dA'],
      wholeDepartmentIds: [],
      isScheduler: true
    })
    expect(normalizeScheduleAccess({ canSchedule: true, supervisorScope: true }).isScheduler).toBe(false)
  })
})

describe('scope filters', () => {
  const scheduler = normalizeScheduleAccess({
    canSchedule: true,
    subDepartmentIds: ['uA1', 'uB1'],
    departmentIds: ['dA', 'dB']
  })

  it('keeps only the departments and units a scheduler was assigned to', () => {
    expect(filterScopeDepartments(departments, scheduler).map(d => d._id)).toEqual(['dA', 'dB'])
    expect(filterScopeSubDepartments(units, scheduler).map(u => u._id)).toEqual(['uA1', 'uB1'])
  })

  it('adds the supervisor scope (own department and units) when the supervisor is also a scheduler', () => {
    expect(filterScopeDepartments(departments, scheduler, ['dC']).map(d => d._id)).toEqual(['dA', 'dB', 'dC'])
    expect(filterScopeSubDepartments(units, scheduler, ['uA2']).map(u => u._id)).toEqual(['uA1', 'uA2', 'uB1'])
  })

  it('gives a whole-department schedule manager every unit of that department', () => {
    const manager = normalizeScheduleAccess({ canSchedule: true, wholeDepartmentIds: ['dA'], departmentIds: ['dA'] })
    expect(filterScopeSubDepartments(units, manager).map(u => u._id)).toEqual(['uA1', 'uA2'])
  })

  it('leaves the lists alone for someone who is not a scheduler', () => {
    const supervisor = normalizeScheduleAccess({ canSchedule: true, supervisorScope: true })
    expect(filterScopeDepartments(departments, supervisor)).toBe(departments)
    expect(filterScopeSubDepartments(units, null)).toBe(units)
  })
})

describe('使用班別 of the viewed units', () => {
  it('limits the shifts to the selection of the unit and shows everything when nothing is selected', () => {
    expect(restrictShifts(shifts, resolveAllowedShiftIds([units[1]])).map(s => s._id)).toEqual(['day', 'rest'])
    expect(restrictShifts(shifts, resolveAllowedShiftIds([units[0]]))).toBe(shifts)
    expect(restrictShifts(shifts, resolveAllowedShiftIds([units[3]]))).toBe(shifts)
    expect(restrictShifts(shifts, resolveAllowedShiftIds([]))).toBe(shifts)
  })

  it('takes the union of several viewed units, or everything when one of them has no selection', () => {
    expect(restrictShifts(shifts, resolveAllowedShiftIds([units[1], units[2]])).map(s => s._id)).toEqual(['day', 'night', 'rest'])
    expect(restrictShifts(shifts, resolveAllowedShiftIds([units[1], units[0]]))).toBe(shifts)
  })

  // 不用上班的班別（休息日、例假、國定假日、請假）每個小單位一律可以用，不論有沒有選
  it('keeps only the selected shifts, rest-type shifts included (客戶 2026/11/11：全部都要能管控)', () => {
    const all = [
      { _id: 'day', code: 'D', name: '白班', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
      { _id: 'night', code: 'N', name: '大夜', semanticType: 'work', startTime: '00:00', endTime: '08:00' },
      { _id: 'rest', code: '休', name: '休息日', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
      { _id: 'regular', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      { _id: 'holiday', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
      { _id: 'personal', code: '事', name: '事假', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
      // 舊資料沒有班別性質：依代碼推斷（與伺服器相同）
      { _id: 'legacyOff', code: 'OFF', name: '休假' },
      // 標成工作班卻沒有工作時間：伺服器也當成不用上班
      { _id: 'zero', code: 'Z', name: '待命', semanticType: 'work', startTime: '00:00', endTime: '00:00' }
    ]
    expect(restrictShifts(all, resolveAllowedShiftIds([units[2]])).map(s => s._id)).toEqual(['night'])
    // 選了休息日就只有選的休息日，其他休假類的班別不會自動加上
    expect(restrictShifts(all, resolveAllowedShiftIds([units[1]])).map(s => s._id)).toEqual(['day', 'rest'])
    expect(all.filter(isNonWorkShift).map(s => s._id)).toEqual(['rest', 'regular', 'holiday', 'personal', 'legacyOff', 'zero'])
    expect(isNonWorkShift(null)).toBe(false)
    // 跨日班不是沒有工作時間
    expect(isNonWorkShift({ code: 'X', semanticType: 'work', startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(false)
  })
})
