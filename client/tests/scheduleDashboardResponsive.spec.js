import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ScheduleDashboard responsive styles', () => {
  it('defines wrapping and card sizing', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../src/views/front/ScheduleDashboard.vue'), 'utf-8')
    expect(file).toMatch(/\.dashboard\s*{[^}]*flex-wrap:\s*wrap/)
    expect(file).toMatch(/\.metric-card\s*{[^}]*width:\s*200px/)
    expect(file).toMatch(/\.metric-icon\s*{[^}]*font-size:\s*16px/)
  })
})
