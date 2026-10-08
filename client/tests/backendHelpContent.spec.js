import { describe, it, expect } from 'vitest'
import { backendHelpContent } from '../src/constants/backendHelpContent'

describe('後台操作說明內容', () => {
  it('每一頁的說明都有標題、描述與非空的情境 / 提示 / 步驟', () => {
    for (const [name, help] of Object.entries(backendHelpContent)) {
      expect(typeof help.title, name).toBe('string')
      expect(help.title.trim(), name).not.toBe('')
      expect(typeof help.description, name).toBe('string')
      for (const key of ['scenarios', 'tips', 'steps']) {
        expect(Array.isArray(help[key]), `${name}.${key}`).toBe(true)
        expect(help[key].length, `${name}.${key}`).toBeGreaterThan(0)
        help[key].forEach(text => expect(String(text).trim(), `${name}.${key}`).not.toBe(''))
      }
    }
  })

  it('簽核流程設定的說明涵蓋標籤、角色 / 層級、停用、略過與管理員代為處理', () => {
    const help = backendHelpContent.ApprovalFlowSetting
    const text = [help.description, ...help.scenarios, ...help.tips, ...help.steps].join('\n')

    // 標籤的詞彙來自員工表單，沒有人持有的標籤會讓必簽關卡送件失敗
    expect(text).toContain('員工管理')
    expect(text).toContain('目前沒有人持有')
    // 角色 / 層級要與員工設定的代碼相符
    expect(text).toContain('R001')
    expect(text).toContain('U001')
    // 有申請單的表單是停用而不是刪除
    expect(text).toContain('停用')
    expect(text).toContain('不能刪除')
    // 略過與管理員代為處理
    expect(text).toContain('自動略過')
    expect(text).toContain('已由其他人處理')
    expect(text).toContain('管理員代為處理')
    // 不再提到已經不存在的「通知對象」設定
    expect(text).not.toContain('通知對象')
  })
})
