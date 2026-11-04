// 排班權限（services/scheduleAccessService.js）讀的模型的測試替身。
// 2026/11 起排班權限模式預設「只有排班人員能排班」（scheduler_only）：測「主管排直屬部屬」的檔案要先把模式存成
// 「主管與排班人員」（supervisor_and_scheduler，管理員在其他控制設定 > 排班權限可以切回去）。
// 測試沒有連線資料庫時，寫入班表前的「使用班別」檢查會 fail closed（503），所以小單位換成
// 沒有排班人員指派、沒有設定使用班別的替身（__setRows 可以放小單位）。用法（要在 import 受測模組之前）：
//   const scheduleAccessMode = await registerScheduleAccessModeMocks(jest);
//   beforeEach(() => scheduleAccessMode.allowSupervisors());   // 主管與排班人員
//   scheduleAccessMode.useDefaultMode();                        // 回到預設（只有排班人員）
// 替身都用一般函式（不是 jest.fn）：測試檔的 jest.resetAllMocks() 不會把它們清掉。
// 要測其他控制設定同時寫入的行為請改用 fakeOtherControlSettingModel.js。
// srcPath 是相對於「呼叫的測試檔」的 src 路徑（tests/ 底下的測試用預設值即可）。

const clone = (value) => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)))

function plainQuery(resolveValue) {
  const query = {
    select: () => query,
    lean: () => Promise.resolve(resolveValue()),
    then: (onFulfilled, onRejected) => Promise.resolve(resolveValue()).then(onFulfilled, onRejected),
  }
  return query
}

// 其他控制設定只有一份文件（key: default）：讀取、upsert（$setOnInsert）、依 revision 條件的 $set／$inc、刪除
function createSettingsModel() {
  let document = null
  return {
    init: async () => {},
    findOne: () => plainQuery(() => clone(document)),
    findOneAndUpdate: (filter, update = {}, options = {}) => plainQuery(() => {
      const previous = clone(document)
      if (!document) {
        if (!options.upsert) return null
        document = { key: filter.key, data: {}, revision: 0, ...clone(update.$setOnInsert) }
        return options.new ? clone(document) : null
      }
      if (filter.revision !== undefined && typeof filter.revision === 'number' && filter.revision !== document.revision) return null
      if (update.$set) Object.assign(document, clone(update.$set))
      if (update.$inc) Object.entries(update.$inc).forEach(([field, amount]) => { document[field] = (document[field] ?? 0) + amount })
      return options.new ? clone(document) : previous
    }),
    deleteOne: async () => {
      const deletedCount = document ? 1 : 0
      document = null
      return { deletedCount }
    },
    __seed(value) {
      document = clone(value)
    },
    __clear() {
      document = null
    },
  }
}

function createSubDepartmentModel() {
  let rows = []
  const matchesIn = (value, condition) => (condition && Array.isArray(condition.$in)
    ? condition.$in.map(String).includes(String(value))
    : String(value) === String(condition))
  const filterRows = (filter = {}) => rows.filter((row) => Object.entries(filter || {}).every(([key, condition]) => {
    const value = row[key]
    if (Array.isArray(value)) return value.map(String).some((item) => matchesIn(item, condition))
    return matchesIn(value, condition)
  }))
  return {
    find: (filter) => plainQuery(() => filterRows(filter)),
    distinct: (field) => plainQuery(() => rows.flatMap((row) => row[field] ?? [])),
    __setRows(list) {
      rows = Array.isArray(list) ? list : []
    },
  }
}

export async function registerScheduleAccessModeMocks(jest, { srcPath = '../src', subDepartment = true } = {}) {
  const settings = createSettingsModel()
  await jest.unstable_mockModule(`${srcPath}/models/OtherControlSetting.js`, () => ({ default: settings }))
  const SubDepartment = createSubDepartmentModel()
  if (subDepartment) {
    await jest.unstable_mockModule(`${srcPath}/models/SubDepartment.js`, () => ({ default: SubDepartment }))
  }
  return {
    settings,
    SubDepartment,
    /** 存成「主管與排班人員都能排班」（2026/11 以前的預設） */
    allowSupervisors() {
      settings.__seed({ key: 'default', data: { scheduleAccessMode: 'supervisor_and_scheduler' }, revision: 1 })
    },
    /** 清掉設定，回到預設的「只有排班人員能排班」 */
    useDefaultMode() {
      settings.__clear()
    },
  }
}
