import { describe, it, expect } from '@jest/globals'
import {
  advanceApprovalState,
  applyReturn,
  isStepComplete,
  restartRequest,
  skipRemainingApprovers,
  startRequest,
} from '../src/services/approvalRequestEngine.js'

const approver = (id, decision = 'pending') => ({ approver: id, decision })
const step = (approvers, extra = {}) => ({
  approvers: approvers.map(item => (typeof item === 'string' ? approver(item) : item)),
  all_must_approve: true,
  is_required: true,
  can_return: true,
  ...extra,
})
const makeDoc = (steps) => ({ status: 'pending', current_step_index: 0, steps, logs: [] })
const actions = (doc) => doc.logs.map(log => log.action)

describe('startRequest', () => {
  it('enters the first step when it has approvers', () => {
    const doc = makeDoc([step(['a']), step(['b'])])
    const result = startRequest(doc)

    expect(result).toEqual({ completed: false, nextApprovers: ['a'] })
    expect(doc.current_step_index).toBe(0)
    expect(doc.steps[0].started_at).toBeInstanceOf(Date)
    expect(doc.status).toBe('pending')
  })

  it('skips an empty optional first step', () => {
    const doc = makeDoc([step([], { is_required: false }), step(['b'])])
    startRequest(doc)

    expect(doc.current_step_index).toBe(1)
    expect(actions(doc)).toEqual(['skip', 'move_next'])
    expect(doc.steps[0].finished_at).toBeInstanceOf(Date)
  })

  it('finishes the request when every step is empty', () => {
    const doc = makeDoc([step([], { is_required: false })])
    expect(startRequest(doc).completed).toBe(true)
    expect(doc.status).toBe('approved')
  })
})

describe('advanceApprovalState', () => {
  it('does nothing while an approver is still pending (all must approve)', () => {
    const doc = makeDoc([step([approver('a', 'approved'), 'b']), step(['c'])])
    expect(advanceApprovalState(doc)).toEqual({ completed: false, nextApprovers: [] })
    expect(doc.current_step_index).toBe(0)
    expect(doc.logs).toEqual([])
  })

  it('moves to the next step once everybody approved', () => {
    const doc = makeDoc([step([approver('a', 'approved'), approver('b', 'approved')]), step(['c'])])
    const result = advanceApprovalState(doc)

    expect(result).toEqual({ completed: false, nextApprovers: ['c'] })
    expect(doc.current_step_index).toBe(1)
    expect(doc.steps[0].finished_at).toBeInstanceOf(Date)
    expect(doc.steps[1].started_at).toBeInstanceOf(Date)
    expect(actions(doc)).toEqual(['move_next'])
  })

  it('approves the request after the last step', () => {
    const doc = makeDoc([step([approver('a', 'approved')])])
    expect(advanceApprovalState(doc)).toEqual({ completed: true, nextApprovers: [] })
    expect(doc.status).toBe('approved')
    expect(actions(doc)).toEqual(['finish'])
  })

  it('skips an empty optional step in the middle', () => {
    const doc = makeDoc([step([approver('a', 'approved')]), step([], { is_required: false }), step(['c'])])
    const result = advanceApprovalState(doc)

    expect(result.nextApprovers).toEqual(['c'])
    expect(doc.current_step_index).toBe(2)
    expect(actions(doc)).toEqual(['skip', 'move_next'])
    expect(doc.logs[0].message).toContain('第 2 關')
  })

  it('finishes when the remaining steps are all empty optional steps', () => {
    const doc = makeDoc([step([approver('a', 'approved')]), step([], { is_required: false }), step([], { is_required: false })])
    const result = advanceApprovalState(doc)

    expect(result.completed).toBe(true)
    expect(doc.status).toBe('approved')
    expect(actions(doc)).toEqual(['skip', 'skip', 'finish'])
  })

  it('marks the other approvers of an any-one step as skipped instead of approved', () => {
    const doc = makeDoc([
      step([approver('a', 'approved'), 'b', 'c'], { all_must_approve: false }),
      step(['d']),
    ])
    const result = advanceApprovalState(doc)

    expect(result.nextApprovers).toEqual(['d'])
    expect(doc.steps[0].approvers.map(item => item.decision)).toEqual(['approved', 'skipped', 'skipped'])
    expect(doc.steps[0].approvers[1].decided_at).toBeInstanceOf(Date)
    expect(doc.steps[0].approvers[1].comment).toBeTruthy()
  })

  it('does not complete an any-one step nobody approved yet', () => {
    const doc = makeDoc([step(['a', 'b'], { all_must_approve: false })])
    expect(advanceApprovalState(doc).completed).toBe(false)
  })
})

describe('isStepComplete', () => {
  it('treats a step without approvers as complete', () => {
    expect(isStepComplete(step([]))).toBe(true)
  })

  it('accepts skipped approvers as done and ignores a missing step', () => {
    expect(isStepComplete(step([approver('a', 'approved'), approver('b', 'skipped')]))).toBe(true)
    expect(isStepComplete(undefined)).toBe(false)
  })

  it('completes an any-one step when no approver is pending even if nobody approved (admin override)', () => {
    expect(isStepComplete(step([approver('a', 'skipped'), approver('b', 'skipped')], { all_must_approve: false }))).toBe(true)
  })
})

describe('skipRemainingApprovers', () => {
  it('only touches pending approvers', () => {
    const target = step([approver('a', 'approved'), 'b'])
    expect(skipRemainingApprovers(target, { comment: '管理員代為核可' })).toBe(1)
    expect(target.approvers.map(item => item.decision)).toEqual(['approved', 'skipped'])
    expect(target.approvers[1].comment).toBe('管理員代為核可')
  })
})

describe('applyReturn', () => {
  it('sends the request back to the applicant from the first step', () => {
    const doc = makeDoc([step([approver('a', 'returned')])])
    expect(applyReturn(doc, 0)).toEqual({ toApplicant: true, targetIndex: null })
    expect(doc.status).toBe('returned')
    expect(doc.steps[0].approvers[0].decision).toBe('returned') // 退簽人的決議保留，歷史才看得到
  })

  it('returns to the previous step and resets it', () => {
    const doc = makeDoc([
      step([approver('a', 'approved'), approver('b', 'approved')]),
      step([approver('c', 'returned')]),
    ])
    doc.current_step_index = 1
    const result = applyReturn(doc, 1)

    expect(result).toEqual({ toApplicant: false, targetIndex: 0 })
    expect(doc.current_step_index).toBe(0)
    expect(doc.steps[0].approvers.map(item => item.decision)).toEqual(['pending', 'pending'])
    expect(doc.steps[1].started_at).toBeUndefined()
  })

  it('walks back over empty steps to the nearest step with approvers', () => {
    const doc = makeDoc([
      step([approver('a', 'approved')]),
      step([], { is_required: false }),
      step([approver('c', 'returned')]),
    ])
    doc.current_step_index = 2
    expect(applyReturn(doc, 2).targetIndex).toBe(0)
    expect(doc.current_step_index).toBe(0)
  })

  it('returns to the applicant when every earlier step is empty', () => {
    const doc = makeDoc([step([], { is_required: false }), step([approver('c', 'returned')])])
    doc.current_step_index = 1
    expect(applyReturn(doc, 1)).toEqual({ toApplicant: true, targetIndex: null })
    expect(doc.status).toBe('returned')
  })

  it('makes everybody in the returned step sign again when the request comes back to it', () => {
    // A 與 B 同在第 2 關：A 核可、B 退簽 → 第 1 關重簽 → 回到第 2 關時 A 也要重簽
    const doc = makeDoc([
      step([approver('x', 'approved')]),
      step([approver('a', 'approved'), approver('b', 'returned')]),
    ])
    doc.current_step_index = 1
    applyReturn(doc, 1)
    doc.steps[0].approvers[0].decision = 'approved'
    const result = advanceApprovalState(doc)

    expect(result.nextApprovers).toEqual(['a', 'b'])
    expect(doc.current_step_index).toBe(1)
    expect(doc.steps[1].approvers.map(item => item.decision)).toEqual(['pending', 'pending'])
  })
})

describe('restartRequest', () => {
  it('clears every decision and starts again from the first step with approvers', () => {
    const doc = makeDoc([
      step([approver('a', 'returned')]),
      step([approver('b', 'approved')]),
    ])
    doc.status = 'returned'
    const result = restartRequest(doc)

    expect(result.nextApprovers).toEqual(['a'])
    expect(doc.status).toBe('pending')
    expect(doc.current_step_index).toBe(0)
    expect(doc.steps.flatMap(item => item.approvers).map(item => item.decision)).toEqual(['pending', 'pending'])
    expect(doc.steps[1].started_at).toBeUndefined()
  })
})
