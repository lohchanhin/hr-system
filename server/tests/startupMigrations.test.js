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
  it('imports migrateLeaveFormSemantics from the approval template controller', () => {
    expect(indexSource).toMatch(/import \{ migrateLeaveFormSemantics \} from '\.\/controllers\/approvalTemplateController\.js';/)
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
})
