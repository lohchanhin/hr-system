import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = file => fs.readFileSync(path.resolve(__dirname, file), 'utf-8')

describe('Schedule workspace design contract', () => {
  it('keeps the schedule grid dense, fixed and operational', () => {
    const styles = read('../src/views/front/ScheduleWorkspace.scss')

    expect(styles).toMatch(/\.modern-schedule-table\s*:deep\(\.el-table-fixed-column--left\)/)
    expect(styles).toMatch(/\.modern-schedule-cell\s*{[\s\S]*?min-height:\s*62px/)
    expect(styles).toMatch(/\.schedule-table-wrapper\s*:deep\(\.el-scrollbar__bar\.is-horizontal\)[\s\S]*?height:\s*12px/)
    expect(styles).not.toMatch(/linear-gradient/)
  })

  it('uses precise motion and respects reduced motion', () => {
    const styles = read('../src/views/front/ScheduleWorkspace.scss')

    expect(styles).not.toMatch(/transition:\s*all/)
    expect(styles).toMatch(/cubic-bezier\(0\.23, 1, 0\.32, 1\)/)
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('keeps one primary selection action', () => {
    const component = read('../src/views/front/SelectionActions.vue')
    const primaryActions = component.match(/class="action-btn primary"/g) || []

    expect(primaryActions).toHaveLength(1)
  })
})
