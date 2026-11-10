// 班別設定的保護（2026-11 複查）：
// - 還有班表在用的班別被刪掉後，那些班表找不到班別：工時、出勤天數算不到（真的資料庫重現：日薪 2000 的人那個月從 1 天 2000 變成 0 天 0 元）。
// - 休息時長填負數、休息時段開始等於結束、夜班津貼金額是 0 這些填錯的情況回 500（只有訊息含「必填」「格式不正確」的才回 400）。
import request from 'supertest'
import express from 'express'
import { jest } from '@jest/globals'

const findOne = jest.fn()
const create = jest.fn()
const countDocuments = jest.fn()
const scheduleFindOne = jest.fn()

jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: { findOne, create } }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({
  default: { countDocuments, findOne: scheduleFindOne },
}))

let app

function buildSetting(shifts = []) {
  shifts.id = (id) => shifts.find((item) => String(item._id) === String(id))
  return { _id: 'setting-1', shifts, save: jest.fn().mockResolvedValue(null) }
}

function buildShift(patch = {}) {
  return {
    _id: 'shift-1',
    name: '日班',
    code: 'D',
    startTime: '08:00',
    endTime: '17:00',
    deleteOne: jest.fn(),
    toObject() {
      return { ...this }
    },
    ...patch,
  }
}

beforeAll(async () => {
  const shiftRoutes = (await import('../src/routes/shiftRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/shifts', (req, _res, next) => {
    req.user = { role: 'admin' }
    next()
  })
  app.use('/api/shifts', shiftRoutes)
})

beforeEach(() => {
  jest.clearAllMocks()
  countDocuments.mockResolvedValue(0)
  scheduleFindOne.mockReturnValue({
    sort: () => ({ select: () => ({ lean: async () => ({ date: new Date('2026-09-01T00:00:00.000Z') }) }) }),
  })
})

describe('刪除班別', () => {
  it('還有班表在使用的班別不能刪除：回 409 並說明有幾筆、最近一筆的日期', async () => {
    const shift = buildShift()
    const setting = buildSetting([shift])
    findOne.mockResolvedValue(setting)
    countDocuments.mockResolvedValue(3)

    const res = await request(app).delete('/api/shifts/shift-1')

    expect(countDocuments).toHaveBeenCalledWith({ shiftId: 'shift-1' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: '「日班」還有 3 筆班表在使用（最近一筆 2026-09-01），不能刪除；請先把這些班表改成其他班別',
      code: 'SHIFT_IN_USE',
      scheduleCount: 3,
      latestDate: '2026-09-01',
    })
    expect(shift.deleteOne).not.toHaveBeenCalled()
    expect(setting.save).not.toHaveBeenCalled()
  })

  it('沒有班表在用的班別照常刪除', async () => {
    const shift = buildShift()
    const setting = buildSetting([shift])
    findOne.mockResolvedValue(setting)

    const res = await request(app).delete('/api/shifts/shift-1')

    expect(res.status).toBe(204)
    expect(shift.deleteOne).toHaveBeenCalled()
    expect(setting.save).toHaveBeenCalled()
  })

  it('找不到班別回 404，不查班表', async () => {
    findOne.mockResolvedValue(buildSetting([]))

    const res = await request(app).delete('/api/shifts/unknown')

    expect(res.status).toBe(404)
    expect(countDocuments).not.toHaveBeenCalled()
  })
})

describe('班別內容填錯回 400（不是 500）', () => {
  const base = { name: '白班', code: 'D1', startTime: '09:00', endTime: '18:00' }

  it.each([
    ['休息時長是負數', { breakDuration: -5 }, '休息時長必須是 0 或以上的數字'],
    ['休息時長不是數字', { breakDuration: 'abc' }, '休息時長必須是 0 或以上的數字'],
    ['休息時段不是陣列', { breakWindows: 'x' }, '休息時段的格式不正確'],
    ['休息時段開始等於結束', { breakWindows: [{ start: '12:00', end: '12:00' }] }, '第 1 筆休息時段的開始與結束不得相同'],
    ['夜班津貼啟用但金額是 0', { isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 0 }, '啟用夜班津貼時，固定津貼金額必須大於 0'],
    ['沒有名稱', { name: '' }, '班別名稱與代碼為必填'],
  ])('新增：%s', async (_label, patch, message) => {
    const setting = buildSetting([])
    findOne.mockResolvedValue(setting)

    const res = await request(app).post('/api/shifts').send({ ...base, ...patch })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(message)
    expect(setting.save).not.toHaveBeenCalled()
  })

  it('修改：休息時長是負數', async () => {
    const setting = buildSetting([buildShift()])
    findOne.mockResolvedValue(setting)

    const res = await request(app).put('/api/shifts/shift-1').send({ breakDuration: -1 })

    expect(res.status).toBe(400)
    expect(setting.save).not.toHaveBeenCalled()
  })

  it('兩位管理員同時修改（VersionError）回 409 與中文說明；其他儲存失敗照舊回 500', async () => {
    const setting = buildSetting([])
    setting.save.mockRejectedValueOnce(Object.assign(new Error('No matching document found for id'), { name: 'VersionError' }))
    findOne.mockResolvedValue(setting)
    const conflict = await request(app).post('/api/shifts').send(base)
    expect(conflict.status).toBe(409)
    expect(conflict.body.error).toBe('班別設定剛被其他人修改，請重新整理後再試')

    const broken = buildSetting([])
    broken.save.mockRejectedValueOnce(new Error('db down'))
    findOne.mockResolvedValue(broken)
    expect((await request(app).post('/api/shifts').send(base)).status).toBe(500)
  })
})
