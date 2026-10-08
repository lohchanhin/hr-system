import { jest } from '@jest/globals'

// 記憶體版的 OtherControlSetting model：只實作 store 會用到的 findOne / findOneAndUpdate / deleteOne / init，
// 行為對齊 MongoDB（upsert + $setOnInsert、以 revision 做條件更新、$set / $inc），讓測試不需要真的資料庫。

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function matches(document, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = document[field]
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((candidate) => (candidate === null ? actual == null : actual === candidate))
    }
    return actual === expected
  })
}

export function createFakeOtherControlSettingModel() {
  const documents = []
  const beforeWriteHooks = []
  const failNextWrites = []
  let readError = null

  async function runFindOneAndUpdate(filter, update, options) {
    const hook = beforeWriteHooks.shift()
    if (hook) await hook(documents)
    const failure = failNextWrites.shift()
    if (failure) throw failure

    const index = documents.findIndex((document) => matches(document, filter))
    if (index === -1) {
      if (!options.upsert) return null
      const inserted = {
        key: filter.key,
        data: {},
        revision: 0,
        ...clone(update.$setOnInsert),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      documents.push(inserted)
      return options.new ? clone(inserted) : null
    }

    const target = documents[index]
    const previous = clone(target)
    if (update.$set) Object.assign(target, clone(update.$set))
    if (update.$inc) {
      for (const [field, amount] of Object.entries(update.$inc)) {
        target[field] = (target[field] ?? 0) + amount
      }
    }
    target.updatedAt = new Date().toISOString()
    return options.new ? clone(target) : previous
  }

  const model = {
    init: jest.fn(async () => {}),
    findOne: jest.fn((filter) => ({
      lean: async () => {
        if (readError) throw readError
        const found = documents.find((document) => matches(document, filter))
        return found ? clone(found) : null
      }
    })),
    findOneAndUpdate: jest.fn((filter, update, options = {}) => ({
      lean: () => runFindOneAndUpdate(filter, update, options)
    })),
    deleteOne: jest.fn(async (filter) => {
      const index = documents.findIndex((document) => matches(document, filter))
      if (index !== -1) documents.splice(index, 1)
      return { deletedCount: index === -1 ? 0 : 1 }
    }),

    // ---- 測試用輔助 ----
    __documents: documents,
    /** 下一次 findOneAndUpdate 真正執行前先跑 fn(documents)，用來模擬「別的程序剛好先寫入」 */
    __beforeNextWrite: (fn) => beforeWriteHooks.push(fn),
    /** 下一次 findOneAndUpdate 直接丟出指定錯誤 */
    __failNextWrite: (error) => failNextWrites.push(error),
    /** 之後每一次 findOne 都丟出指定錯誤，直到 __clear() */
    __breakReads: (error) => {
      readError = error
    },
    /** 直接在「資料庫」塞入／取代文件（模擬重啟前已存在的資料） */
    __seed: (document) => {
      documents.splice(0, documents.length, clone(document))
    },
    __clear: () => {
      documents.splice(0, documents.length)
      beforeWriteHooks.length = 0
      failNextWrites.length = 0
      readError = null
    }
  }

  return model
}
