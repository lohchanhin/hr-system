import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// start() 不會在測試環境執行（NODE_ENV=test），也沒有匯出；這裡以原始碼確認啟動流程的順序與寫法，
// 真正在資料庫上跑一次啟動的行為由端到端檢查負責。
const indexSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js'),
  'utf8',
).replace(/\r\n/g, '\n')

function startBody() {
  const begin = indexSource.indexOf('async function start()')
  const end = indexSource.indexOf("if (process.env.NODE_ENV !== 'test')", begin)
  expect(begin).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(begin)
  return indexSource.slice(begin, end)
}

describe('server startup migrations', () => {
  it('imports normalizeStoredSignTags from the employee controller', () => {
    expect(indexSource).toMatch(/import \{ normalizeStoredSignTags \} from '\.\/controllers\/employeeController\.js';/)
  })

  it('normalizes the stored sign tags right after the database connects and before everything else, including the admin bootstrap', () => {
    const body = startBody()
    const connect = body.indexOf('await connectDB(')
    const signTags = body.indexOf('await normalizeStoredSignTags()')
    const shiftSemantics = body.indexOf('await migrateMissingShiftSemantics()')
    const purge = body.indexOf('await purgeLegacyRocWeekendHolidays()')
    const leaveMigration = body.indexOf('await migrateLeaveFormSemantics()')
    const admin = body.indexOf('await ensureAdminUser()')

    expect(signTags).toBeGreaterThan(-1)
    expect(connect).toBeLessThan(signTags)
    expect(signTags).toBeLessThan(shiftSemantics)
    expect(signTags).toBeLessThan(purge)
    expect(signTags).toBeLessThan(leaveMigration)
    expect(signTags).toBeLessThan(admin)
    // 兩者之間沒有別的 await：就在連上資料庫之後
    const between = body.slice(connect + 'await connectDB('.length, signTags)
    expect(between).not.toMatch(/\bawait\b/)
  })

  it('does not let a failing sign tag normalization stop the server, and only logs the count or the error name', () => {
    const body = startBody()
    const call = body.indexOf('await normalizeStoredSignTags()')
    const tryStart = body.lastIndexOf('try {', call)
    const catchStart = body.indexOf('} catch (normalizeError) {', call)
    const catchEnd = body.indexOf('\n    }\n', catchStart)

    expect(tryStart).toBeGreaterThan(-1)
    expect(body.slice(tryStart, call)).not.toContain('}') // try 區塊就是從這一行開始
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, catchEnd)
    expect(handler).toContain("console.error('Failed to normalize sign tags', normalizeError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
    // 成功時只記錄人數，不記錄標籤內容
    const success = body.slice(call, catchStart)
    expect(success).toContain('console.log(`Normalized sign tags for ${normalizedSignTags} employees`)')
  })

  it('imports migrateLeaveFormSemantics from the approval template controller', () => {
    expect(indexSource).toMatch(/import \{ migrateLeaveFormSemantics, migrateLeaveKeywordForms \} from '\.\/controllers\/approvalTemplateController\.js';/)
  })

  it('runs the leave form migration after the other startup migrations and before the admin bootstrap', () => {
    const body = startBody()
    const connect = body.indexOf('await connectDB(')
    const shiftSemantics = body.indexOf('await migrateMissingShiftSemantics()')
    const purge = body.indexOf('await purgeLegacyRocWeekendHolidays()')
    const leaveMigration = body.indexOf('await migrateLeaveFormSemantics()')
    const admin = body.indexOf('await ensureAdminUser()')

    expect(connect).toBeGreaterThan(-1)
    expect(leaveMigration).toBeGreaterThan(-1)
    expect(connect).toBeLessThan(shiftSemantics)
    expect(shiftSemantics).toBeLessThan(purge)
    expect(purge).toBeLessThan(leaveMigration)
    expect(leaveMigration).toBeLessThan(admin)
  })

  it('does not let a failing leave form migration stop the server, and only logs counts or the error name', () => {
    const body = startBody()
    const call = body.indexOf('await migrateLeaveFormSemantics()')
    const tryStart = body.lastIndexOf('try {', call)
    const catchStart = body.indexOf('} catch (migrateError) {', call)
    const catchEnd = body.indexOf('\n    }\n', catchStart)

    expect(tryStart).toBeGreaterThan(-1)
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, catchEnd)
    expect(handler).toContain("console.error('Failed to migrate leave form semantics', migrateError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
    // 成功時只記錄筆數
    const success = body.slice(call, catchStart)
    expect(success).toContain('console.log(`Migrated semantic types for ${migratedLeaveForms} leave forms`)')
  })

  it('runs the one-off 假別 leave keyword migration right after the leave form migration, guarded and count-only', () => {
    const body = startBody()
    const leaveMigration = body.indexOf('await migrateLeaveFormSemantics()')
    const call = body.indexOf('await migrateLeaveKeywordForms()')
    const admin = body.indexOf('await ensureAdminUser()')
    expect(call).toBeGreaterThan(leaveMigration)
    expect(call).toBeLessThan(admin)

    const tryStart = body.lastIndexOf('try {', call)
    const catchStart = body.indexOf('} catch (keywordError) {', call)
    const catchEnd = body.indexOf('\n    }\n', catchStart)
    expect(tryStart).toBeGreaterThan(leaveMigration)
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, catchEnd)
    expect(handler).toContain("console.error('Failed to migrate leave keyword forms', keywordError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
    expect(body.slice(call, catchStart)).toContain('console.log(`Migrated semantic types for ${migratedKeywordForms} leave forms (假別)`)')
  })
})

// 請假改以「小時」為單位的兩個一次性資料搬移（新模組 services/leaveHoursMigration.js，各自獨立的 try/catch，只記錄筆數或錯誤名稱）
describe('server startup: leave hours migrations', () => {
  it('imports both migrations from their own module (the pinned import of approvalTemplateController stays as it is)', () => {
    expect(indexSource).toMatch(/import \{ migrateAnnualLeaveToHours, migrateLeaveFormsToHours \} from '\.\/services\/leaveHoursMigration\.js';/)
  })

  it('runs the annual leave migration, then the form migration, after the leave form semantics migrations and before the admin bootstrap', () => {
    const body = startBody()
    const keywordForms = body.indexOf('await migrateLeaveKeywordForms()')
    const annual = body.indexOf('await migrateAnnualLeaveToHours()')
    const forms = body.indexOf('await migrateLeaveFormsToHours()')
    const admin = body.indexOf('await ensureAdminUser()')

    expect(annual).toBeGreaterThan(keywordForms)
    expect(forms).toBeGreaterThan(annual)
    expect(admin).toBeGreaterThan(forms)
  })

  it('does not let a failing annual leave migration stop the server, and only logs counts or the error name', () => {
    const body = startBody()
    const call = body.indexOf('await migrateAnnualLeaveToHours()')
    const tryStart = body.lastIndexOf('try {', call)
    const catchStart = body.indexOf('} catch (annualLeaveError) {', call)
    const catchEnd = body.indexOf('\n    }\n', catchStart)

    expect(tryStart).toBeGreaterThan(-1)
    expect(body.slice(tryStart, call)).not.toContain('}')
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, catchEnd)
    expect(handler).toContain("console.error('Failed to migrate annual leave to hours', annualLeaveError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
    // 成功時只記錄筆數（沒有搬移任何員工時不記錄）
    const success = body.slice(call, catchStart)
    expect(success).toContain('annualLeaveMigration?.migrated')
    expect(success).toContain('Migrated annual leave to hours for ${annualLeaveMigration.migrated} employees')
    expect(success).not.toMatch(/employee\.|\.name|annualLeave\.(total|used)/)
  })

  it('does not let a failing leave form migration stop the server, and only logs counts or the error name', () => {
    const body = startBody()
    const call = body.indexOf('await migrateLeaveFormsToHours()')
    const tryStart = body.lastIndexOf('try {', call)
    const catchStart = body.indexOf('} catch (leaveHoursError) {', call)
    const catchEnd = body.indexOf('\n    }\n', catchStart)

    expect(tryStart).toBeGreaterThan(-1)
    expect(catchStart).toBeGreaterThan(call)
    const handler = body.slice(catchStart, catchEnd)
    expect(handler).toContain("console.error('Failed to migrate leave forms to hours', leaveHoursError?.name ?? 'Error')")
    expect(handler).not.toMatch(/process\.exit|throw /)
    expect(body.slice(call, catchStart)).toContain('Added leave hours field to ${leaveFormMigration.added} leave forms')
  })
})

// 公司行事曆（國定假日分類）的資料轉換、索引、原民假額度與每日檢查（各自獨立的 try/catch，只記錄筆數或錯誤名稱）
describe('server startup: holiday calendar', () => {
  function blockAround(body, call, catchMarker) {
    const callIndex = body.indexOf(call)
    const tryStart = body.lastIndexOf('try {', callIndex)
    const catchStart = body.indexOf(catchMarker, callIndex)
    const catchEnd = body.indexOf('}', body.indexOf('{', catchStart + catchMarker.length - 1) + 1)
    return { callIndex, tryStart, catchStart, handler: body.slice(catchStart, catchEnd + 1), success: body.slice(callIndex, catchStart) }
  }

  it('imports the calendar migration, the watcher, the daily compensation sync and the leave quota migration (the purge import stays as it is)', () => {
    expect(indexSource).toMatch(/import \{ purgeLegacyRocWeekendHolidays \} from '\.\/controllers\/holidayController\.js';/)
    expect(indexSource).toMatch(/import \{ migrateHolidayCalendarKinds, ensureHolidayCalendarIndexes \} from '\.\/services\/holidayCalendarMigration\.js';/)
    expect(indexSource).toMatch(/import \{ startHolidayCalendarWatcher \} from '\.\/services\/companyCalendarService\.js';/)
    expect(indexSource).toMatch(/import \{ syncRecentHolidayCompensations \} from '\.\/services\/holidayCompensationService\.js';/)
    expect(indexSource).toMatch(/import \{ migrateIndigenousLeaveQuota \} from '\.\/services\/leavePolicyService\.js';/)
    expect(indexSource).toMatch(/import companyCalendarRoutes from '\.\/routes\/companyCalendarRoutes\.js';/)
    expect(indexSource).toMatch(/import holidayCalendarViewRoutes from '\.\/routes\/holidayCalendarViewRoutes\.js';/)
  })

  it('mounts the admin calendar settings and the read-only holiday calendar before the API 404 handler', () => {
    const settings = indexSource.indexOf("app.use('/api/company-calendar', authenticate, authorizeRoles('admin'), companyCalendarRoutes);")
    const view = indexSource.indexOf("app.use('/api/holiday-calendar', authenticate, authorizeRoles('employee', 'supervisor', 'admin'), holidayCalendarViewRoutes);")
    const notFound = indexSource.indexOf("app.use('/api', apiNotFound);")

    expect(settings).toBeGreaterThan(-1)
    expect(view).toBeGreaterThan(-1)
    expect(settings).toBeLessThan(notFound)
    expect(view).toBeLessThan(notFound)
  })

  it('runs purge < calendar kinds < calendar indexes < leave form semantics', () => {
    const body = startBody()
    const purge = body.indexOf('await purgeLegacyRocWeekendHolidays()')
    const kinds = body.indexOf('await migrateHolidayCalendarKinds()')
    const indexes = body.indexOf('await ensureHolidayCalendarIndexes()')
    const leaveMigration = body.indexOf('await migrateLeaveFormSemantics()')

    expect(purge).toBeGreaterThan(-1)
    expect(purge).toBeLessThan(kinds)
    expect(kinds).toBeLessThan(indexes)
    expect(indexes).toBeLessThan(leaveMigration)
  })

  it('runs the indigenous leave quota migration after the leave form hours migration and before the admin bootstrap', () => {
    const body = startBody()
    const forms = body.indexOf('await migrateLeaveFormsToHours()')
    const quota = body.indexOf('await migrateIndigenousLeaveQuota()')
    const admin = body.indexOf('await ensureAdminUser()')

    expect(quota).toBeGreaterThan(forms)
    expect(quota).toBeLessThan(admin)
  })

  it.each([
    ['await migrateHolidayCalendarKinds()', '} catch (calendarError) {', "console.error('Failed to migrate holiday calendar kinds', calendarError?.name ?? 'Error')"],
    ['await ensureHolidayCalendarIndexes()', '} catch (indexError) {', "console.error('Failed to ensure holiday calendar indexes', indexError?.name ?? 'Error')"],
    ['await migrateIndigenousLeaveQuota()', '} catch (quotaError) {', "console.error('Failed to migrate indigenous leave quota', quotaError?.name ?? 'Error')"],
  ])('guards %s with its own try/catch that only logs the error name', (call, catchMarker, logLine) => {
    const body = startBody()
    const { callIndex, tryStart, catchStart, handler } = blockAround(body, call, catchMarker)

    expect(callIndex).toBeGreaterThan(-1)
    expect(tryStart).toBeGreaterThan(-1)
    expect(body.slice(tryStart, callIndex)).not.toContain('}')
    expect(catchStart).toBeGreaterThan(callIndex)
    expect(handler).toContain(logLine)
    expect(handler).not.toMatch(/process\.exit|throw /)
  })

  it('logs only counts after the calendar migration and the quota migration', () => {
    const body = startBody()
    const kinds = blockAround(body, 'await migrateHolidayCalendarKinds()', '} catch (calendarError) {').success
    expect(kinds).toContain('if (calendarMigration?.rows) console.log(`Migrated holiday calendar kinds for ${calendarMigration.rows} rows in ${calendarMigration.years} years')
    expect(kinds).toContain('Holiday rest resolutions on non-statutory dates: ${calendarMigration.orphanResolutions}')
    expect(kinds).toContain('Holiday moves whose source is not a statutory holiday: ${calendarMigration.orphanMoves}')
    expect(kinds).not.toMatch(/\.name\b|holidayName|employee/)

    const quota = blockAround(body, 'await migrateIndigenousLeaveQuota()', '} catch (quotaError) {').success
    expect(quota).toContain('Updated indigenous leave quota to 3 days in ${indigenousQuota.updated} stored leave policies')
  })

  it('starts the daily holiday calendar watcher inside app.listen, with the compensation sync, unless switched off', () => {
    const body = startBody()
    const listen = body.indexOf('app.listen(PORT, () => {')
    const running = body.indexOf('console.log(`Server running on port ${PORT}`);')
    const watcher = body.indexOf("if (process.env.HOLIDAY_CALENDAR_WATCHER !== 'off') startHolidayCalendarWatcher({ dailyTasks: [syncRecentHolidayCompensations] });")

    expect(listen).toBeGreaterThan(-1)
    expect(running).toBeGreaterThan(listen)
    expect(watcher).toBeGreaterThan(running)
    expect(body.slice(running, watcher)).not.toContain('});')
    // 匯入 index.js 的測試很多：模組層級不能啟動計時器或連網路
    expect(indexSource.slice(0, indexSource.indexOf('async function start()'))).not.toMatch(/startHolidayCalendarWatcher\(/)
  })
})
