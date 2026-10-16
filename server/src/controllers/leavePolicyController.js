import {
  LeavePolicyValidationError,
  getDefaultLeavePolicy,
  getLeavePolicy,
  saveLeavePolicy,
} from '../services/leavePolicyService.js'

// 假別額度規則（其他控制設定的 leavePolicy 區塊）。只有管理員能進這兩支（掛在其他控制設定的管理員路由底下）。
const READ_FAILED_MESSAGE = '無法讀取假別額度規則，請稍後再試'
const WRITE_FAILED_MESSAGE = '無法儲存假別額度規則，請稍後再試'

function sendFailure(res, error, fallbackMessage) {
  if (error instanceof LeavePolicyValidationError) {
    return res.status(error.status).json({ error: error.message })
  }
  // 只記錄錯誤名稱：資料庫錯誤訊息可能帶連線資訊
  console.error('[leavePolicy] request failed:', error?.name ?? 'Error')
  return res.status(500).json({ error: fallbackMessage })
}

/** GET /api/other-control-settings/leave-policy - 目前生效的規則與系統預設值（「還原預設」用） */
export async function getLeavePolicySettings(req, res) {
  try {
    const policy = await getLeavePolicy({ fresh: true })
    res.json({ policy, defaults: getDefaultLeavePolicy() })
  } catch (error) {
    sendFailure(res, error, READ_FAILED_MESSAGE)
  }
}

/** PUT /api/other-control-settings/leave-policy - 儲存規則（內建假別沒送的欄位維持預設值） */
export async function updateLeavePolicySettings(req, res) {
  try {
    const policy = await saveLeavePolicy(req.body)
    res.json({ policy, defaults: getDefaultLeavePolicy() })
  } catch (error) {
    sendFailure(res, error, WRITE_FAILED_MESSAGE)
  }
}

export default { getLeavePolicySettings, updateLeavePolicySettings }
