import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ScheduleDashboard responsive styles', () => {
  it('uses a compact responsive summary grid', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../src/views/front/ScheduleDashboard.vue'), 'utf-8')
    expect(file).toMatch(/\.dashboard\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
    expect(file).toMatch(/\.metric-card\s*{[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\) auto/)
    expect(file).toMatch(/@media \(max-width: 700px\)[\s\S]*grid-template-columns:\s*1fr/)
  })
})
