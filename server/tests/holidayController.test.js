import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'

const create = jest.fn()
const find = jest.fn()
const findById = jest.fn()
const findByIdAndUpdate = jest.fn()
const findByIdAndDelete = jest.fn()
const findOneAndUpdate = jest.fn()
const deleteMany = jest.fn()
const exists = jest.fn()
const updateOne = jest.fn()
const findHolidayMoves = jest.fn()
const importYearCompat = jest.fn()
const markCalendarYearEdited = jest.fn()

jest.unstable_mockModule('../src/models/Holiday.js', () => ({
  default: {
    create,
    find,
    findById,
    findByIdAndUpdate,
    findByIdAndDelete,
    findOneAndUpdate,
    deleteMany,
    exists,
    updateOne,
  },
}))
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({
  default: { find: findHolidayMoves },
}))
// 年度流程（草稿、核定、政府資料）在 companyCalendarService 測試；這裡只確認行事曆 CRUD 有通知年度狀態
jest.unstable_mockModule('../src/services/companyCalendarService.js', () => ({
  importYearCompat,
  markCalendarYearEdited,
  isImportManagedRow: (row) => ['public', 'rule', 'migrated'].includes(
    row?.origin || (row?.source === 'roc-calendar' ? 'migrated' : 'manual'),
  ),
}))

let holidayRoutes
let purgeLegacyRocWeekendHolidays

beforeAll(async () => {
  holidayRoutes = (await import('../src/routes/holidayRoutes.js')).default
  ;({ purgeLegacyRocWeekendHolidays } = await import('../src/controllers/holidayController.js'))
})

// 寫入路由只有管理員可用，所以測試要模擬已登入的使用者；role 為 null 表示沒有登入資訊
function buildApp(role = 'admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    if (role) req.user = { id: 'tester', role }
    next()
  })
  app.use('/api/holidays', holidayRoutes)
  app.use('/api/holidays-public', holidayRoutes)
  return app
}

const day = (key) => new Date(`${key}T00:00:00.000Z`)
const sorted = (rows) => ({ sort: jest.fn().mockResolvedValue(rows) })

function currentTaipeiYear() {
  return Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))
}

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn()
  findHolidayMoves.mockResolvedValue([])
  deleteMany.mockResolvedValue({ deletedCount: 0 })
  exists.mockResolvedValue(null)
  updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
  markCalendarYearEdited.mockResolvedValue(undefined)
})

describe('holidayController: the import/roc compatibility alias', () => {
  // 舊版是逐筆以日期 upsert（會蓋掉人資的修改）；現在改由 companyCalendarService 建立草稿或要求人資檢視差異
  it('applies the single government file as a draft on an empty year and reports the rows created', async () => {
    importYearCompat.mockResolvedValue({ applied: true, year: currentTaipeiYear(), imported: 22, state: 'draft' })

    const res = await request(buildApp()).post('/api/holidays/import/roc')

    expect(res.status).toBe(200)
    expect(importYearCompat).toHaveBeenCalledWith({ year: currentTaipeiYear(), actorId: 'tester' })
    expect(res.body).toEqual({ success: true, year: currentTaipeiYear(), imported: 22, count: 22, state: 'draft' })
    expect(findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing and asks for a review when the year already has a calendar or several files', async () => {
    importYearCompat.mockResolvedValue({ applied: false, year: 2025, candidates: [{ snapshotId: 's1' }, { snapshotId: 's2' }] })

    const res = await request(buildApp()).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'REVIEW_REQUIRED', year: 2025, candidates: [{ snapshotId: 's1' }, { snapshotId: 's2' }] })
    expect(res.body.error).toContain('行事曆設定')
    expect(create).not.toHaveBeenCalled()
    expect(findOneAndUpdate).not.toHaveBeenCalled()
    // 舊版匯入會順便清掉週末雜訊；新流程不再在匯入時刪除任何資料
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('does not touch stored holidays when the government calendar cannot be loaded', async () => {
    importYearCompat.mockRejectedValue(Object.assign(new Error('SOURCE_UNAVAILABLE'), { code: 'SOURCE_UNAVAILABLE' }))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(buildApp()).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    expect(deleteMany).not.toHaveBeenCalled()
    expect(findOneAndUpdate).not.toHaveBeenCalled()
    console.error.mockRestore()
  })

  it('rejects a malformed government file without writing anything', async () => {
    importYearCompat.mockRejectedValue(Object.assign(new Error('INVALID_CSV'), { code: 'INVALID_CSV', detail: 'ROW_COUNT' }))

    const res = await request(buildApp()).post('/api/holidays/import/roc?year=2025')

    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ code: 'INVALID_CSV', detail: 'ROW_COUNT' })
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('rejects a year outside the accepted range before fetching', async () => {
    const res = await request(buildApp()).post('/api/holidays/import/roc?year=1800')

    expect(res.status).toBe(400)
    expect(importYearCompat).not.toHaveBeenCalled()
  })
})

describe('holidayController: calendar days CRUD', () => {
  it('fills the name from desc and maps a legacy payload to a statutory day', async () => {
    create.mockResolvedValue({ _id: 'new-holiday', name: '元旦', date: '2025-01-01', desc: '元旦', kind: 'statutory' })

    const res = await request(buildApp()).post('/api/holidays').send({
      date: '2025/01/01',
      type: '國定假日',
      desc: '元旦',
    })

    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: '元旦',
      description: '元旦',
      type: '國定假日',
      kind: 'statutory',
      origin: 'manual',
      source: 'manual',
      archived: false,
      year: 2025,
      updatedBy: 'tester',
    }))
    expect(create.mock.calls[0][0].date.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(markCalendarYearEdited).toHaveBeenCalledWith(2025, 'tester')
    expect(res.body).toMatchObject({ _id: 'new-holiday', kind: 'statutory', displayKind: 'holiday' })
  })

  it('creates a designated day with excluded employees and a government make-up day with its link', async () => {
    create.mockImplementation(async (doc) => ({ _id: 'h-new', ...doc }))
    find.mockResolvedValue([{ date: day('2026-02-28'), kind: 'statutory', name: '和平紀念日' }])

    const designated = await request(buildApp()).post('/api/holidays').send({
      date: '2026-11-28',
      kind: 'designated',
      name: '地方公職人員選舉',
      excludedEmployees: ['507f1f77bcf86cd799439011'],
    })
    const makeup = await request(buildApp()).post('/api/holidays').send({
      date: '2026-02-27',
      kind: 'gov_makeup_off',
      name: '補假',
      compensatesDate: '2026-02-28',
    })

    expect(designated.status).toBe(201)
    expect(create.mock.calls[0][0]).toMatchObject({ kind: 'designated', type: '指定應放假日', excludedEmployees: ['507f1f77bcf86cd799439011'] })
    expect(makeup.status).toBe(201)
    expect(create.mock.calls[1][0]).toMatchObject({ kind: 'gov_makeup_off', compensatesName: '和平紀念日', linkMethod: 'manual' })
    expect(create.mock.calls[1][0].compensatesDate.toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(makeup.body.displayKind).toBe('gov_info')
  })

  it.each([
    [{ date: '2026-03-03', kind: 'holiday-ish', name: 'x' }, 'INVALID_KIND'],
    [{ date: '2026-03-03', kind: 'company_off', name: '' }, 'NAME_REQUIRED'],
    [{ date: '2026-03-03', kind: 'company_off', name: 'x'.repeat(101) }, 'NAME_TOO_LONG'],
    [{ date: '2026-03-03', kind: 'statutory', name: '端午節', compensatesDate: '2026-02-28' }, 'COMPENSATES_NOT_ALLOWED'],
    [{ date: '2026-03-03', kind: 'statutory', name: '端午節', excludedEmployees: ['507f1f77bcf86cd799439011'] }, 'EXCLUSION_NOT_ALLOWED'],
    [{ date: '2026-11-28', kind: 'designated', name: '選舉', excludedEmployees: ['not-an-id'] }, 'INVALID_EMPLOYEE'],
    [{ date: '2026-02-30', kind: 'company_off', name: 'x' }, 'INVALID_DATE'],
  ])('rejects invalid input %#', async (body, code) => {
    const res = await request(buildApp()).post('/api/holidays').send(body)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(code)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a second active row of the same kind on the same day', async () => {
    exists.mockResolvedValue({ _id: 'existing' })

    const res = await request(buildApp()).post('/api/holidays').send({ date: '2026-06-19', kind: 'statutory', name: '端午節' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ code: 'DUPLICATE_DAY', error: '這一天已有相同類型的行事曆紀錄' })
    expect(create).not.toHaveBeenCalled()
  })

  it('marks an import-managed row as edited by HR when it is changed', async () => {
    findById.mockResolvedValue({ _id: 'h1', date: day('2026-02-27'), kind: 'gov_makeup_off', name: '補假', origin: 'public', compensatesDate: day('2026-02-28'), linkMethod: 'rule' })
    findByIdAndUpdate.mockImplementation(async (_id, update) => ({ _id: 'h1', ...update.$set }))

    const res = await request(buildApp()).put('/api/holidays/h1').send({ kind: 'company_off', name: '公司休息日' })

    expect(res.status).toBe(200)
    const [, update] = findByIdAndUpdate.mock.calls[0]
    expect(update.$set).toMatchObject({ kind: 'company_off', name: '公司休息日', type: '公司休息日', hrEdited: true, compensatesDate: null })
    expect(update.$unset).toEqual({ linkMethod: '' })
    expect(markCalendarYearEdited).toHaveBeenCalledWith(2026, 'tester')
  })

  it('does not flag a manual row as HR-edited and keeps its kind when only the name changes', async () => {
    findById.mockResolvedValue({ _id: 'h2', date: day('2026-07-03'), kind: 'company_off', name: '院慶', origin: 'manual' })
    findByIdAndUpdate.mockImplementation(async (_id, update) => ({ _id: 'h2', ...update.$set }))

    const res = await request(buildApp()).put('/api/holidays/h2').send({ name: '院慶（全院）' })

    expect(res.status).toBe(200)
    expect(findByIdAndUpdate.mock.calls[0][1].$set).toMatchObject({ kind: 'company_off', name: '院慶（全院）' })
    expect(findByIdAndUpdate.mock.calls[0][1].$set.hrEdited).toBeUndefined()
  })

  it('hard-deletes a manual row but keeps an import-managed row as a tombstone', async () => {
    findById.mockResolvedValueOnce({ _id: 'm1', date: day('2026-07-03'), kind: 'company_off', origin: 'manual' })
    findByIdAndDelete.mockResolvedValue({ _id: 'm1' })
    const manual = await request(buildApp()).delete('/api/holidays/m1')

    findById.mockResolvedValueOnce({ _id: 'p1', date: day('2026-02-20'), kind: 'gov_makeup_off', origin: 'public' })
    const imported = await request(buildApp()).delete('/api/holidays/p1')

    expect(manual.status).toBe(200)
    expect(findByIdAndDelete).toHaveBeenCalledTimes(1)
    expect(imported.status).toBe(200)
    expect(imported.body).toEqual({ success: true, archived: true })
    expect(updateOne).toHaveBeenCalledWith({ _id: 'p1' }, { $set: { archived: true, hrEdited: true, updatedBy: 'tester' } })
    expect(markCalendarYearEdited).toHaveBeenCalledTimes(2)
  })

  it('restores a tombstone as an HR decision', async () => {
    findById
      .mockResolvedValueOnce({ _id: 'p1', date: day('2026-02-20'), kind: 'gov_makeup_off', origin: 'public', archived: true, hrEdited: true })
      .mockResolvedValueOnce({ _id: 'p1', date: day('2026-02-20'), kind: 'gov_makeup_off', origin: 'public', archived: false, hrEdited: true })

    const res = await request(buildApp()).post('/api/holidays/p1/restore')

    expect(res.status).toBe(200)
    expect(updateOne).toHaveBeenCalledWith({ _id: 'p1' }, { $set: { archived: false, hrEdited: true, kind: 'gov_makeup_off', updatedBy: 'tester' } })
    expect(res.body).toMatchObject({ archived: false, displayKind: 'gov_info' })
  })

  it('lists one year without tombstones, adds the display kind and filters by kind', async () => {
    find.mockReturnValue(sorted([
      { _id: 'a', date: day('2026-02-27'), kind: 'gov_makeup_off', name: '補假' },
      { _id: 'b', date: day('2026-02-28'), kind: 'statutory', name: '和平紀念日' },
      { _id: 'c', date: day('2026-03-01'), type: '國定假日', name: '補假', source: 'roc-calendar' },
    ]))

    const res = await request(buildApp()).get('/api/holidays?year=2026&kind=statutory')

    expect(res.status).toBe(200)
    expect(find.mock.calls[0][0]).toEqual({
      archived: { $ne: true },
      date: { $gte: day('2026-01-01'), $lt: day('2027-01-01') },
    })
    expect(res.body).toEqual([expect.objectContaining({ _id: 'b', kind: 'statutory', displayKind: 'holiday' })])

    find.mockReturnValue(sorted([]))
    await request(buildApp()).get('/api/holidays?includeArchived=true')
    expect(find.mock.calls[1][0]).toEqual({})
  })

  // 人資把匯入的日子改到別天：原日期要留下已刪除紀錄，否則下一次匯入會把原日期加回（行政人員同一個國定假日放兩天補假）
  it('leaves a tombstone on the original date when HR moves an import-managed row to another day', async () => {
    findById.mockResolvedValue({
      _id: 'g1011',
      date: day('2027-10-11'),
      kind: 'gov_makeup_off',
      name: '補假',
      origin: 'public',
      source: 'dgpa',
      compensatesDate: day('2027-10-10'),
      compensatesName: '國慶日',
      linkMethod: 'rule',
      publicSnapshot: 'snap-2027',
    })
    find.mockResolvedValue([{ date: day('2027-10-10'), kind: 'statutory', name: '國慶日' }])
    findByIdAndUpdate.mockImplementation(async (_id, update) => ({ _id: 'g1011', ...update.$set }))

    const res = await request(buildApp()).put('/api/holidays/g1011').send({ date: '2027-10-12' })

    expect(res.status).toBe(200)
    expect(findByIdAndUpdate.mock.calls[0][1].$set).toMatchObject({ hrEdited: true, kind: 'gov_makeup_off' })
    expect(findByIdAndUpdate.mock.calls[0][1].$set.date.toISOString()).toBe('2027-10-12T00:00:00.000Z')
    expect(create).toHaveBeenCalledTimes(1)
    const tombstone = create.mock.calls[0][0]
    expect(tombstone).toMatchObject({
      kind: 'gov_makeup_off',
      name: '補假',
      type: '公務機關補假',
      origin: 'public',
      source: 'dgpa',
      publicSnapshot: 'snap-2027',
      compensatesName: '國慶日',
      linkMethod: 'rule',
      archived: true,
      hrEdited: true,
      updatedBy: 'tester',
    })
    expect(tombstone.date.toISOString()).toBe('2027-10-11T00:00:00.000Z')
    expect(tombstone.reviewNote).toContain('2027-10-12')
    // 先留下紀錄再改日期
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(findByIdAndUpdate.mock.invocationCallOrder[0])
  })

  it('does not leave a tombstone when the date stays, for manual rows, or when one already exists', async () => {
    findByIdAndUpdate.mockImplementation(async (_id, update) => ({ _id: 'x', ...update.$set }))

    findById.mockResolvedValueOnce({ _id: 's1', date: day('2027-10-10'), kind: 'statutory', name: '國慶日', origin: 'public' })
    await request(buildApp()).put('/api/holidays/s1').send({ name: '國慶日（雙十節）' })

    findById.mockResolvedValueOnce({ _id: 'm1', date: day('2027-07-03'), kind: 'company_off', name: '院慶', origin: 'manual' })
    await request(buildApp()).put('/api/holidays/m1').send({ date: '2027-07-05' })

    findById.mockResolvedValueOnce({ _id: 's2', date: day('2027-06-09'), kind: 'statutory', name: '端午節', origin: 'public' })
    exists.mockImplementation(async (filter) => (filter.archived === true ? { _id: 'old-tombstone' } : null))
    await request(buildApp()).put('/api/holidays/s2').send({ date: '2027-06-10' })

    expect(findByIdAndUpdate).toHaveBeenCalledTimes(3)
    expect(create).not.toHaveBeenCalled()
  })

  it('clears the review flag when HR saves a row', async () => {
    findById.mockResolvedValue({
      _id: 'm2',
      date: day('2026-07-01'),
      kind: 'statutory',
      name: '公司創立紀念日',
      origin: 'manual',
      needsReview: true,
      reviewNote: '手動新增、名稱不在法定假日清單，請確認類型',
    })
    findByIdAndUpdate.mockImplementation(async (_id, update) => ({ _id: 'm2', ...update.$set }))

    const res = await request(buildApp()).put('/api/holidays/m2').send({ kind: 'company_off', name: '公司創立紀念日', note: '院內休息日' })

    expect(res.status).toBe(200)
    expect(findByIdAndUpdate.mock.calls[0][1].$set).toMatchObject({ kind: 'company_off', needsReview: false, reviewNote: '' })
    expect(res.body).toMatchObject({ needsReview: false })
  })

  it('confirms a row that needs review without counting it as an HR edit or reopening the year', async () => {
    findById.mockResolvedValue({ _id: 'p9', date: day('2026-03-02'), kind: 'gov_bridge_off', name: '颱風假', origin: 'public', needsReview: true, reviewNote: '請確認' })

    const res = await request(buildApp()).post('/api/holidays/p9/confirm')

    expect(res.status).toBe(200)
    expect(updateOne).toHaveBeenCalledWith({ _id: 'p9' }, { $set: { needsReview: false, reviewNote: '', updatedBy: 'tester' } })
    expect(res.body).toMatchObject({ _id: 'p9', needsReview: false, reviewNote: '', displayKind: 'gov_info' })
    expect(markCalendarYearEdited).not.toHaveBeenCalled()

    findById.mockResolvedValue(null)
    const missing = await request(buildApp()).post('/api/holidays/nope/confirm')
    expect(missing.status).toBe(404)
  })
})

// 指定應放假日「不適用的員工」記錄的是誰沒有投票權（例如外籍員工），屬於個人資料：只有管理員看得到
describe('holidayController: what non-admin readers see', () => {
  const designated = {
    _id: 'd1',
    date: day('2026-11-28'),
    kind: 'designated',
    name: '地方公職人員選舉',
    excludedEmployees: ['507f1f77bcf86cd799439011'],
    note: '外籍員工無投票權',
    reviewNote: '人資備註',
    updatedBy: '507f1f77bcf86cd799439099',
    publicSnapshot: 'snap-1',
  }

  it.each(['employee', 'supervisor'])('strips personal and internal fields for %s on the list and by-month', async (role) => {
    find.mockReturnValue(sorted([designated]))
    const list = await request(buildApp(role)).get('/api/holidays-public?year=2026&kind=designated')
    find.mockReturnValue(sorted([designated]))
    const byMonth = await request(buildApp(role)).get('/api/holidays-public/by-month?month=2026-11')

    for (const res of [list, byMonth]) {
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0]).toMatchObject({ _id: 'd1', kind: 'designated', name: '地方公職人員選舉', displayKind: 'designated' })
      for (const field of ['excludedEmployees', 'note', 'reviewNote', 'updatedBy', 'publicSnapshot']) {
        expect(res.body[0]).not.toHaveProperty(field)
      }
    }
  })

  it('ignores includeArchived for non-admin readers', async () => {
    find.mockReturnValue(sorted([]))

    await request(buildApp('employee')).get('/api/holidays-public?includeArchived=true')

    expect(find.mock.calls[0][0]).toEqual({ archived: { $ne: true } })
  })

  it('keeps every field for administrators', async () => {
    find.mockReturnValue(sorted([designated]))

    const res = await request(buildApp('admin')).get('/api/holidays-public?year=2026')

    expect(res.body[0]).toMatchObject({ excludedEmployees: ['507f1f77bcf86cd799439011'], note: '外籍員工無投票權', updatedBy: '507f1f77bcf86cd799439099' })
  })
})

describe('holidayController: by-month', () => {
  it('returns the effective target date for a same-month holiday move', async () => {
    find.mockReturnValue(sorted([{
      _id: 'holiday-1',
      name: '國定假日',
      type: '國定假日',
      date: day('2036-04-07'),
    }]))
    findHolidayMoves.mockResolvedValue([{
      _id: 'move-1',
      enableHolidayMove: true,
      sourceDate: day('2036-04-07'),
      targetDate: day('2036-04-20'),
    }])

    const res = await request(buildApp()).get('/api/holidays/by-month?month=2036-04')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      source: 'holiday-move',
      movedFrom: '2036-04-07',
      holidayMoveId: 'move-1',
      kind: 'statutory',
      displayKind: 'holiday',
    })
    expect(new Date(res.body[0].date).toISOString()).toBe('2036-04-20T00:00:00.000Z')
  })

  it('applies a company move across months: removed from the source month, added to the target month', async () => {
    const source = { _id: 'h228', date: day('2027-02-28'), kind: 'statutory', name: '和平紀念日' }
    findHolidayMoves.mockResolvedValue([{ _id: 'move-2', enableHolidayMove: true, sourceDate: day('2027-02-28'), targetDate: day('2027-03-02') }])

    find.mockReturnValueOnce(sorted([source]))
    const february = await request(buildApp()).get('/api/holidays/by-month?month=2027-02')
    expect(february.body).toEqual([])

    find.mockReturnValueOnce(sorted([{ _id: 'h301', date: day('2027-03-01'), kind: 'gov_makeup_off', name: '補假' }]))
      .mockResolvedValueOnce([source])
    const march = await request(buildApp()).get('/api/holidays/by-month?month=2027-03')

    expect(march.body.map((row) => [row.date.slice(0, 10), row.kind, row.movedFrom ?? null])).toEqual([
      ['2027-03-01', 'gov_makeup_off', null],
      ['2027-03-02', 'statutory', '2027-02-28'],
    ])
    expect(find.mock.calls[2][0].date.$in.map((value) => value.toISOString())).toEqual(['2027-02-28T00:00:00.000Z'])
  })

  it('ignores a move whose source is not a statutory day', async () => {
    find.mockReturnValue(sorted([{ _id: 'g1', date: day('2026-02-20'), kind: 'gov_makeup_off', name: '補假' }]))
    findHolidayMoves.mockResolvedValue([{ _id: 'move-3', enableHolidayMove: true, sourceDate: day('2026-02-20'), targetDate: day('2026-02-24') }])

    const res = await request(buildApp()).get('/api/holidays/by-month?month=2026-02')

    expect(res.body).toEqual([expect.objectContaining({ _id: 'g1', kind: 'gov_makeup_off', displayKind: 'gov_info' })])
  })
})

describe('purgeLegacyRocWeekendHolidays', () => {
  it('only targets nameless, not yet migrated entries that the ROC import created, across all years when no year is given', async () => {
    deleteMany.mockResolvedValue({ deletedCount: 7 })

    const removed = await purgeLegacyRocWeekendHolidays()

    expect(removed).toBe(7)
    const [filter] = deleteMany.mock.calls[0]
    expect(filter.source).toBe('roc-calendar')
    expect(filter.kind).toEqual({ $exists: false })
    expect(filter.date).toBeUndefined()
    expect(filter.$or).toEqual([
      { description: { $exists: false } },
      { description: null },
      { description: { $regex: expect.any(RegExp) } },
    ])
    // 空字串與只有空白都算沒有名稱；有名稱的不算
    const blank = filter.$or[2].description.$regex
    expect(blank.test('')).toBe(true)
    expect(blank.test('  ')).toBe(true)
    expect(blank.test('春節')).toBe(false)
  })

  // 2026 年 1～8 月的舊版匯入在 UTC+8 主機上把日期存成前一天 16:00Z：星期要以台灣時間判斷，否則週六會被當成週五
  it('decides the weekday in Taipei time', async () => {
    deleteMany.mockResolvedValue({ deletedCount: 0 })

    await purgeLegacyRocWeekendHolidays()

    expect(deleteMany.mock.calls[0][0].$expr).toEqual({
      $in: [{ $dayOfWeek: { date: '$date', timezone: 'Asia/Taipei' } }, [1, 7]],
    })
  })

  it('limits the clean-up to one year when a year is given', async () => {
    deleteMany.mockResolvedValue({ deletedCount: 0 })

    await purgeLegacyRocWeekendHolidays({ year: 2026 })

    expect(deleteMany.mock.calls[0][0].date).toEqual({
      $gte: new Date('2026-01-01T00:00:00.000Z'),
      $lt: new Date('2027-01-01T00:00:00.000Z'),
    })
  })
})

describe('holiday write access', () => {
  it.each(['employee', 'supervisor'])('rejects %s on every write route, under both mounts', async (role) => {
    const app = buildApp(role)
    const responses = []
    for (const base of ['/api/holidays', '/api/holidays-public']) {
      responses.push(
        await request(app).post(base).send({ date: '2025-01-01', desc: '元旦' }),
        await request(app).put(`${base}/h1`).send({ date: '2025-01-01', desc: '元旦' }),
        await request(app).delete(`${base}/h1`),
        await request(app).post(`${base}/h1/restore`),
        await request(app).post(`${base}/import/roc?year=2025`),
      )
    }

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(403))
    expect(create).not.toHaveBeenCalled()
    expect(findByIdAndUpdate).not.toHaveBeenCalled()
    expect(findByIdAndDelete).not.toHaveBeenCalled()
    expect(updateOne).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
    expect(importYearCompat).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each(['employee', 'supervisor'])('rejects %s on the confirm route, under both mounts', async (role) => {
    const app = buildApp(role)

    const responses = [
      await request(app).post('/api/holidays/h1/confirm'),
      await request(app).post('/api/holidays-public/h1/confirm'),
    ]

    expect(responses.map((response) => response.status)).toEqual([403, 403])
    expect(updateOne).not.toHaveBeenCalled()
  })

  it('rejects write requests that carry no authenticated user', async () => {
    const app = buildApp(null)

    const res = await request(app).post('/api/holidays-public').send({ date: '2025-01-01', desc: '元旦' })

    expect(res.status).toBe(403)
    expect(create).not.toHaveBeenCalled()
  })

  it('lets an administrator create, update and delete holidays through the public mount too', async () => {
    const app = buildApp('admin')
    create.mockResolvedValue({ _id: 'h1' })
    findById.mockResolvedValue({ _id: 'h1', date: day('2025-01-01'), kind: 'statutory', name: '元旦', origin: 'manual' })
    findByIdAndUpdate.mockResolvedValue({ _id: 'h1', name: '元旦' })
    findByIdAndDelete.mockResolvedValue({ _id: 'h1' })

    const created = await request(app).post('/api/holidays-public').send({ date: '2025-01-01', type: '國定假日', desc: '元旦' })
    const updated = await request(app).put('/api/holidays-public/h1').send({ date: '2025-01-01', desc: '元旦' })
    const deleted = await request(app).delete('/api/holidays-public/h1')

    expect([created.status, updated.status, deleted.status]).toEqual([201, 200, 200])
  })

  it.each(['employee', 'supervisor', 'admin'])('keeps by-month and list reads open to %s', async (role) => {
    const app = buildApp(role)
    find.mockReturnValue(sorted([{
      _id: 'holiday-1',
      name: '開國紀念日',
      type: '國定假日',
      date: day('2025-01-01'),
    }]))

    const byMonth = await request(app).get('/api/holidays-public/by-month?month=2025-01')
    const list = await request(app).get('/api/holidays-public')

    expect(byMonth.status).toBe(200)
    expect(byMonth.body).toHaveLength(1)
    expect(list.status).toBe(200)
  })
})
