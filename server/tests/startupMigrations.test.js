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
