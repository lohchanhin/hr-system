import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('ScheduleDashboard responsive styles', () => {
  // 2026/11 介面規範：三個統計數字改放在頁首，用共用的精簡統計樣式（.hr-stat），不再是三張大卡片
  it('uses the compact shared header stats that wrap on narrow screens', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../src/views/front/ScheduleDashboard.vue'), 'utf-8')
    expect(file).toMatch(/class="hr-stat"/)
    expect(file).toMatch(/class="hr-stat__label"/)
    expect(file).toMatch(/class="hr-stat__value"/)
    expect(file).toMatch(/\.schedule-stats\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/)
    expect(file).not.toMatch(/metric-card/)
  })
})
