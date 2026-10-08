// 簽核測試共用工具：
// - queryResult：像 Mongoose Query 一樣可串接 sort / skip / limit / populate / lean / select，也可直接 await，並記錄呼叫。
// - createFakeEmployeeModel：只實作簽核人解析用到的查詢運算子的 Employee.find / findById（記憶體內）。
// - 固定的 24 位十六進位 id，符合控制器的 ObjectId 格式檢查。
import { jest } from '@jest/globals'

export function oid(n) {
  return String(n).padStart(24, '0').slice(-24)
}

// 同時支援 await 與 .lean()，和 mongoose 的 findById 一樣
export function leanable(value) {
  return Object.assign(Promise.resolve(value), { lean: () => Promise.resolve(value) })
}

export function queryResult(value) {
  const query = {
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    populate: jest.fn(() => query),
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  }
  return query
}

function matchValue(actual, condition) {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === '$in') return expected.map(String).includes(String(actual))
      if (operator === '$nin') return !expected.map(String).includes(String(actual))
      if (operator === '$ne') return String(actual) !== String(expected)
      if (operator === '$exists') return (actual !== undefined) === Boolean(expected)
      throw new Error(`fake Employee model: unsupported operator ${operator}`)
    })
  }
  if (Array.isArray(actual)) return actual.map(String).includes(String(condition))
  return String(actual) === String(condition)
}

function readPath(row, key) {
  return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), row)
}

export function createFakeEmployeeModel(rows) {
  const matches = (row, filter) => Object.entries(filter).every(([key, condition]) => {
    const actual = readPath(row, key)
    // 預設值：沒有 accountEnabled 視為啟用，沒有 status 視為正職
    if (key === 'accountEnabled' && actual === undefined) return matchValue(true, condition)
    if (key === 'status' && actual === undefined) return matchValue('正職員工', condition)
    return matchValue(actual, condition)
  })
  return {
    rows,
    find: jest.fn(async (filter = {}) => rows.filter(row => matches(row, filter)).map(row => ({ ...row }))),
    findById: jest.fn(async id => {
      const row = rows.find(item => String(item._id) === String(id))
      return row ? { ...row } : null
    }),
  }
}
