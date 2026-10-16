/**
 * 員工特休「天數 -> 時數」搬移的維運工具（伺服器啟動時本來就會自動搬一次，這支是手動使用）。
 *
 *   node scripts/migrate-annual-leave-hours.js --dry-run     只統計筆數，不寫入
 *   node scripts/migrate-annual-leave-hours.js               立刻執行搬移（冪等，已搬移的員工不會再動）
 *   node scripts/migrate-annual-leave-hours.js --report      列出「單位是推斷出來的」員工（給人資核對，不寫入）
 *   node scripts/migrate-annual-leave-hours.js --rollback    回復用：把 totalDays / usedDays 寫成 時數 / 8
 *                                                            （回復到舊版程式之前使用；舊版只認天數欄位）
 *
 * 單位以「整份資料」判斷：只要有任何一位員工的天數欄位數字大於 40（不可能是天數），客戶就是把小時填在天數欄位，
 * 所有還沒搬移的員工都原樣當小時；整份資料都沒有超過 40 的數字才乘 8。已經搬移過的員工數字不會被自動改，
 * 整份資料是小時慣例時，先前被乘 8 的員工只會被標成「待確認」（員工管理的編輯畫面會顯示提醒）。
 *
 * 執行與 --dry-run 只輸出筆數，不輸出員工資料。--report 會列出員工編號與姓名（tab 分隔，可貼進試算表），只在維運人員自己的終端機使用：
 *   employeeId  name  totalDays  usedDays  totalHours  usedHours  unitSource  reading
 * totalDays / usedDays 是搬移時凍結的舊欄位；reading 是現在的總時數相當於舊數字乘 8（days x8）、原值（as hours）或已被改過（edited）。
 */
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import Employee from '../src/models/Employee.js'
import {
  buildAnnualLeaveUnitReport,
  migrateAnnualLeaveToHours,
  previewAnnualLeaveMigration,
} from '../src/services/leaveHoursMigration.js'

dotenv.config()

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined')
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const rollback = args.has('--rollback')
const report = args.has('--report')

async function rollbackToDays() {
  const employees = await Employee.find({ 'annualLeave.totalHours': { $exists: true } })
    .select('annualLeave.totalHours annualLeave.usedHours')
    .lean()
  if (dryRun) return employees.length
  const operations = employees.map((employee) => ({
    updateOne: {
      // 更新要在每一個 updateOne 上關掉 timestamps（bulkWrite 的 timestamps 選項只管新增／取代）
      timestamps: false,
      filter: { _id: employee._id },
      update: {
        $set: {
          'annualLeave.totalDays': Math.round(((employee.annualLeave?.totalHours || 0) / 8) * 10000) / 10000,
          'annualLeave.usedDays': Math.round(((employee.annualLeave?.usedHours || 0) / 8) * 10000) / 10000,
        },
      },
    },
  }))
  if (operations.length) await Employee.bulkWrite(operations, { timestamps: false })
  return operations.length
}

const cell = (value) => (value === null || value === undefined ? '' : String(value).replace(/[\t\r\n]+/g, ' '))

async function main() {
  await connectDB(process.env.MONGODB_URI)
  if (rollback) {
    const count = await rollbackToDays()
    console.log(`${dryRun ? 'Would write' : 'Wrote'} totalDays/usedDays (hours / 8) for ${count} employees`)
  } else if (report) {
    const { hoursConvention, rows } = await buildAnnualLeaveUnitReport()
    console.log(['employeeId', 'name', 'totalDays', 'usedDays', 'totalHours', 'usedHours', 'unitSource', 'reading'].join('\t'))
    for (const row of rows) {
      console.log([row.employeeId, row.name, row.totalDays, row.usedDays, row.totalHours, row.usedHours, row.unitSource, row.reading].map(cell).join('\t'))
    }
    console.log(`# ${rows.length} employees listed; hours typed in the days column: ${hoursConvention ? 'yes' : 'no'}`)
  } else if (dryRun) {
    const { pending, fromDays, alreadyHours, hoursConvention, toFlag } = await previewAnnualLeaveMigration()
    console.log(
      `Would migrate annual leave to hours for ${pending} employees (days x8: ${fromDays}, already hours: ${alreadyHours}; ` +
      `hours typed in the days column: ${hoursConvention ? 'yes' : 'no'}), and flag ${toFlag} earlier days-x8 employees for confirmation`
    )
  } else {
    const result = await migrateAnnualLeaveToHours()
    console.log(
      `Migrated annual leave to hours for ${result.migrated} employees ` +
      `(days x8: ${result.fromDays}, already hours: ${result.alreadyHours}, repaired: ${result.repaired}, flagged for confirmation: ${result.flagged})`
    )
  }
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('Annual leave migration failed', error?.name ?? 'Error')
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
