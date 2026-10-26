import { describe, it, expect } from 'vitest'
import {
  filterScopeDepartments,
  filterScopeSubDepartments,
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
})
