import { describe, it, expect } from 'vitest'
import {
  ANNUAL_LEAVE_INSUFFICIENT,
  ApprovalApiError,
  annualLeaveShortageMessage,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  describeError,
  errorText,
  readApiError,
  translateServerMessage,
  violationLines,
} from '../src/utils/approvalErrors'

const response = (status, body) => ({ status, ok: false, json: () => Promise.resolve(body) })

describe('approvalErrors 伺服器訊息翻譯', () => {
  it('中文訊息原樣保留', () => {
    expect(translateServerMessage('此單已被處理，請重新整理')).toBe('此單已被處理，請重新整理')
  })

  it('REQUIRED_APPROVER_MISSING 的中文訊息直接使用，英文則依關卡編號補成中文', () => {
    const message = '【請假】第2關（標籤：人資）找不到可簽核的人員，請聯絡管理員設定'
    expect(translateServerMessage(message, { code: 'REQUIRED_APPROVER_MISSING', step: 2 })).toBe(message)
    expect(translateServerMessage('required approval step 2 has no approver', { code: 'REQUIRED_APPROVER_MISSING', step: 2 }))
      .toBe('第 2 關找不到可簽核的人員，請聯絡管理員設定')
    expect(translateServerMessage('required approval step 3 has no approver'))
      .toBe('第 3 關找不到可簽核的人員，請聯絡管理員設定')
  })

  it('常見英文訊息對應成中文', () => {
    const cases = {
      'not step approver or already acted': '此單已被處理',
      'Approval request changed; reload and retry': '此單已被處理，請重新整理',
      'return not allowed': '此關卡不允許退簽',
      'form not available': '此表單已停用',
      'workflow not configured': '尚未設定簽核流程',
      'not pending': '已不是待簽核',
      'Forbidden': '沒有權限',
      'not found': '找不到',
    }
    for (const [english, expected] of Object.entries(cases)) {
      const text = translateServerMessage(english, { status: 400 })
      expect(text).toContain(expected)
      expect(text).not.toMatch(/[A-Za-z]{4,}/)
    }
  })

  it('不認得的英文訊息（含 Mongoose 訊息）改用依狀態碼的中文說明，不外洩英文', () => {
    expect(translateServerMessage('Cast to ObjectId failed for value "x"', { status: 400 })).toContain('資料格式有誤')
    expect(translateServerMessage('boom', { status: 500 })).toContain('系統暫時發生問題')
    expect(translateServerMessage('', { status: 429 })).toContain('太頻繁')
    expect(translateServerMessage(undefined, { status: 0 })).toBe(GENERIC_ERROR_MESSAGE)
  })
})

describe('approvalErrors violations', () => {
  it('每個檢核結果一行，去除空白與重複，接受字串與物件', () => {
    expect(violationLines([
      { rule: 'a', message: '事假必須填寫事由' },
      { rule: 'b', message: '事假必須填寫事由' },
      { rule: 'c', message: '  ' },
      '請假申請必須附上相關證明',
      { rule: 'only-rule' },
    ])).toEqual(['事假必須填寫事由', '請假申請必須附上相關證明', 'only-rule'])
    expect(violationLines(undefined)).toEqual([])
  })

  it('readApiError 保留 violations、code 與 step', async () => {
    const error = await readApiError(response(400, {
      error: '送簽資料檢核未通過',
      violations: [{ message: '必填欄位不可空白：代理人' }, { message: '加班申請必須先有當日班表' }],
    }))
    expect(error).toBeInstanceOf(ApprovalApiError)
    expect(error.message).toBe('送簽資料檢核未通過')
    expect(error.lines).toEqual(['必填欄位不可空白：代理人', '加班申請必須先有當日班表'])
    expect(error.status).toBe(400)

    const missing = await readApiError(response(400, {
      error: '【請假】第2關（標籤：人資）找不到可簽核的人員，請聯絡管理員設定',
      code: 'REQUIRED_APPROVER_MISSING',
      step: 2,
    }))
    expect(missing.code).toBe('REQUIRED_APPROVER_MISSING')
    expect(missing.step).toBe(2)
    expect(missing.message).toContain('標籤：人資')
  })

  it('回應不是 JSON 時改用狀態碼說明', async () => {
    const error = await readApiError({ status: 502, ok: false, json: () => Promise.reject(new Error('bad json')) })
    expect(error.message).toContain('系統暫時發生問題')
  })

  it('errorText 把檢核結果逐行接在訊息後面', () => {
    expect(errorText({ message: '送簽資料檢核未通過', lines: ['甲', '乙'] })).toBe('送簽資料檢核未通過\n・甲\n・乙')
    expect(errorText({ message: '失敗', lines: [] })).toBe('失敗')
  })
})

describe('approvalErrors describeError', () => {
  it('網路失敗顯示通用中文訊息', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toMatchObject({ message: NETWORK_ERROR_MESSAGE, network: true })
    expect(describeError(new TypeError('NetworkError when attempting to fetch resource.')).network).toBe(true)
    expect(describeError(new TypeError('Load failed')).network).toBe(true)
  })

  it('程式內自己丟的中文訊息原樣顯示；其他錯誤不外洩英文細節', () => {
    expect(describeError(new Error('請填寫必填欄位：事由')).message).toBe('請填寫必填欄位：事由')
    expect(describeError(new Error('x is undefined')).message).toBe(GENERIC_ERROR_MESSAGE)
    expect(describeError(null, '預設訊息').message).toBe('預設訊息')
  })

  it('ApprovalApiError 帶出 lines 與狀態碼', () => {
    const info = describeError(new ApprovalApiError({ message: '失敗', lines: ['甲'], status: 409, code: 'X' }))
    expect(info).toEqual({ message: '失敗', lines: ['甲'], code: 'X', status: 409, network: false })
  })
})

// 特休餘額不足：送出 400、核准 409（code ANNUAL_LEAVE_INSUFFICIENT），訊息要講差多少與怎麼辦
describe('annualLeaveShortageMessage / readApiError（特休餘額不足）', () => {
  const res = (status, body) => ({ status, json: async () => body })

  it('送出（400）：伺服器的中文訊息加上怎麼辦', async () => {
    const error = await readApiError(res(400, { error: '特休餘額不足：剩餘 8 小時（1 天），本次申請 16 小時（2 天）', code: ANNUAL_LEAVE_INSUFFICIENT, remainingHours: 8, requestedHours: 16 }))
    expect(error.code).toBe(ANNUAL_LEAVE_INSUFFICIENT)
    expect(error.status).toBe(400)
    expect(error.message).toBe('特休餘額不足：剩餘 8 小時（1 天），本次申請 16 小時（2 天）。請減少請假時數、改請其他假別，或等簽核中的特休處理完再送出。')
  })

  it('核准（409）：伺服器已經寫了怎麼辦就不重複', () => {
    const error = '特休餘額不足，無法核准：剩餘 4 小時，這張單需要 8 小時（1 天）。請人資確認特休時數，或退簽請申請人修改'
    expect(annualLeaveShortageMessage({ error, code: ANNUAL_LEAVE_INSUFFICIENT }, 409)).toBe(`${error}。`)
  })

  it('舊版伺服器的英文訊息：用回應裡的數字組成中文（有簽核中的特休時寫出可請時數）', () => {
    expect(annualLeaveShortageMessage({ error: 'Insufficient annual leave', remainingHours: 16, pendingHours: 8, availableHours: 8, requestedHours: 16 }, 400))
      .toBe('特休餘額不足：剩餘 16 小時（2 天）、其他簽核中的特休 8 小時（1 天）、可請 8 小時（1 天）、本次申請 16 小時（2 天）。請減少請假時數、改請其他假別，或等簽核中的特休處理完再送出。')
    expect(annualLeaveShortageMessage({ remainingHours: -2, requestedHours: 8 }, 409))
      .toBe('特休餘額不足，無法核准：剩餘 0 小時、這張單需要 8 小時（1 天）。請人資確認特休時數，或退簽請申請人修改。')
    expect(annualLeaveShortageMessage({}, 400)).toBe('特休餘額不足。請減少請假時數、改請其他假別，或等簽核中的特休處理完再送出。')
  })
})
