import { describe, it, expect, vi, beforeEach } from 'vitest'

// 簽核頁的提示與確認（取代瀏覽器原生的 alert / confirm）
const { message, confirm } = vi.hoisted(() => ({ message: vi.fn(), confirm: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: message, ElMessageBox: { confirm } }))

import { confirmAction, notifyFailure, notifySuccess } from '../src/utils/approvalNotify'

beforeEach(() => {
  message.mockReset()
  confirm.mockReset()
})

const textOf = (vnode) => (vnode.children || []).map(child => child.children).join('\n')

describe('approvalNotify', () => {
  it('成功：不擋畫面的訊息，3 秒後自己消失', () => {
    notifySuccess('已送出！')
    expect(message).toHaveBeenCalledWith({ type: 'success', message: '已送出！', duration: 3000 })
  })

  it('成功但伺服器附帶提醒（超過額度、特休扣減失敗）：警告樣式、每條一行、要自己關掉才會消失', () => {
    notifySuccess('送出申請成功！', ['事假今年額度 112 小時，將超出 12 小時', '', null])
    expect(message).toHaveBeenCalledTimes(1)
    const options = message.mock.calls[0][0]
    expect(options).toMatchObject({ type: 'warning', duration: 0, showClose: true })
    expect(textOf(options.message)).toBe('送出申請成功！\n事假今年額度 112 小時，將超出 12 小時')
  })

  it('失敗：標題加上伺服器回傳的中文原因，停留較久而且可以關閉', () => {
    notifyFailure('動作失敗', '這張簽核單剛被其他人更新，請重新整理後再試')
    expect(message).toHaveBeenCalledWith({
      type: 'error',
      message: '動作失敗：這張簽核單剛被其他人更新，請重新整理後再試',
      duration: 6000,
      showClose: true,
    })
    notifyFailure('', '請先選擇申請表單')
    expect(message.mock.calls[1][0].message).toBe('請先選擇申請表單')
  })

  it('確認：按確認回傳 true，取消或關閉回傳 false；破壞性操作的確認鍵是紅色', async () => {
    confirm.mockResolvedValueOnce('confirm')
    await expect(confirmAction('確定撤回這筆申請？', { title: '撤回申請', confirmText: '撤回', cancelText: '不撤回', danger: true })).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith('確定撤回這筆申請？', '撤回申請', {
      confirmButtonText: '撤回',
      cancelButtonText: '不撤回',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })

    confirm.mockRejectedValueOnce('cancel')
    await expect(confirmAction('重新載入會清除目前已填寫的內容')).resolves.toBe(false)
    expect(confirm.mock.calls[1]).toEqual(['重新載入會清除目前已填寫的內容', '請確認', {
      confirmButtonText: '確定',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: '',
    }])
  })
})
