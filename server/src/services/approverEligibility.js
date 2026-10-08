// 「可簽核人員」的統一定義（K1）。
// 一位員工只有在「帳號未停用」且「在職狀態不是離職員工／留職停薪」時，才能被當成簽核人：
// 與 middleware/auth.js 的登入規則一致——不能登入的人，簽核單派給他只會永遠卡住。
// 簽核人解析、標籤詞彙表、流程設定的檢查等都應共用這裡，不要各寫一份。

export const INACTIVE_EMPLOYMENT_STATUSES = Object.freeze(['離職員工', '留職停薪'])

/**
 * 回傳可直接展開進 Employee.find() 的過濾片段。
 * 每次回傳新物件，避免呼叫端不小心改到共用的陣列。
 */
export function eligibleEmployeeFilter() {
  return {
    accountEnabled: { $ne: false },
    status: { $nin: [...INACTIVE_EMPLOYMENT_STATUSES] }
  }
}

/**
 * 判斷單一員工文件是否為可簽核人員（找不到的員工、null 一律視為不可）。
 */
export function isEligibleApprover(employee) {
  if (!employee || typeof employee !== 'object') return false
  if (employee.accountEnabled === false) return false
  return !INACTIVE_EMPLOYMENT_STATUSES.includes(employee.status)
}

export default { INACTIVE_EMPLOYMENT_STATUSES, eligibleEmployeeFilter, isEligibleApprover }
