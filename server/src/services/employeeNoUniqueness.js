// 員工編號（Employee.employeeId）唯一：匯入、報表、薪資匯出、考勤匯入都用員工編號認人。
// schema 上原本的 employeeId 索引是一般索引（正式環境已經建好的那一個，不動它）；這裡另外建一個
// 「非空白的員工編號不能重複」的唯一索引（partialFilterExpression：只看非空字串，沒有編號或空白的舊資料不受限制）。
// 啟動時（index.js）：
// - 先計算目前有幾個員工編號被兩位以上的員工使用（只記錄筆數，不列出是誰、不修改資料、不會讓啟動失敗）
// - 沒有重複才建立唯一索引（已經建好就不再動，可以重複執行）
// - 有重複時不建索引：請人資先在員工管理修正重複的編號，下次啟動會自動建立
// 新增、修改員工的 API 本來就會先檢查重複（employeeController 的 checkEmployeeNoAvailable）；索引擋的是兩個請求同時送出的情況。
import Employee from '../models/Employee.js'

export const EMPLOYEE_NO_UNIQUE_INDEX_NAME = 'employeeId_unique_nonblank'
// 字串之間才比較：{ $gt: '' } 只會選到非空字串（數字、null、沒有這個欄位都不會被選到）
const NON_BLANK_EMPLOYEE_NO = { employeeId: { $gt: '' } }

/** 重複的員工編號：{ values（幾個編號重複）, employees（這些編號共有幾位員工） } */
export async function countDuplicateEmployeeNumbers(model = Employee) {
  const [summary] = await model.aggregate([
    { $match: NON_BLANK_EMPLOYEE_NO },
    { $group: { _id: '$employeeId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $group: { _id: null, values: { $sum: 1 }, employees: { $sum: '$count' } } },
  ])
  return { values: summary?.values ?? 0, employees: summary?.employees ?? 0 }
}

/**
 * 啟動時呼叫。回傳 { status, duplicates }：
 * status：'created'（這次建立）、'exists'（之前已建立）、'duplicates'（有重複，沒有建立）、'race'（建立時剛好有人寫入重複的編號）
 */
export async function ensureEmployeeNoUniqueIndex(model = Employee) {
  const indexes = await model.collection.indexes()
  if (indexes.some((index) => index.name === EMPLOYEE_NO_UNIQUE_INDEX_NAME)) {
    return { status: 'exists', duplicates: { values: 0, employees: 0 } }
  }
  const duplicates = await countDuplicateEmployeeNumbers(model)
  if (duplicates.values > 0) return { status: 'duplicates', duplicates }
  try {
    await model.collection.createIndex(
      { employeeId: 1 },
      { name: EMPLOYEE_NO_UNIQUE_INDEX_NAME, unique: true, partialFilterExpression: NON_BLANK_EMPLOYEE_NO },
    )
    return { status: 'created', duplicates }
  } catch (error) {
    if (error?.code === 11000) return { status: 'race', duplicates: await countDuplicateEmployeeNumbers(model) }
    throw error
  }
}

/** 啟動記錄的一行文字（只有筆數） */
export function describeEmployeeNoUniqueness(result) {
  if (!result) return ''
  if (result.status === 'created') return 'Created unique index on non-blank employee numbers (employeeId)'
  if (result.status === 'duplicates' || result.status === 'race') {
    return `Employee numbers used by more than one employee: ${result.duplicates.values} numbers, ${result.duplicates.employees} employees; unique index not created (fix the duplicates in 員工管理, it is created on the next start)`
  }
  return ''
}

export default { countDuplicateEmployeeNumbers, ensureEmployeeNoUniqueIndex, describeEmployeeNoUniqueness }
