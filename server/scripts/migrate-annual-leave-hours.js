/**
 * 員工特休「天數 -> 時數」搬移的維運工具（伺服器啟動時本來就會自動搬一次，這支是手動使用）。
 *
 *   node scripts/migrate-annual-leave-hours.js --dry-run     只統計筆數，不寫入
 *   node scripts/migrate-annual-leave-hours.js               立刻執行搬移（冪等，已搬移的員工不會再動）
 *   node scripts/migrate-annual-leave-hours.js --rollback    回復用：把 totalDays / usedDays 寫成 時數 / 8
 *                                                            （回復到舊版程式之前使用；舊版只認天數欄位）
 *
 * 只輸出筆數，不輸出員工資料。
 */
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import Employee from '../src/models/Employee.js'
import { interpretLegacyAnnualLeave } from '../src/utils/annualLeaveHours.js'
import { migrateAnnualLeaveToHours } from '../src/services/leaveHoursMigration.js'

dotenv.config()

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined')
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const rollback = args.has('--rollback')

async function countPending() {
  const candidates = await Employee.find({ annualLeave: { $type: 'object' }, 'annualLeave.totalHours': { $exists: false } })
    .select('annualLeave.totalDays annualLeave.usedDays')
    .lean()
  let fromDays = 0
  let alreadyHours = 0
  for (const employee of candidates) {
    const result = interpretLegacyAnnualLeave(employee.annualLeave?.totalDays, employee.annualLeave?.usedDays)
    if (result.unitSource === 'migrated-hours') alreadyHours += 1
    else fromDays += 1
  }
  return { pending: candidates.length, fromDays, alreadyHours }
}

async function rollbackToDays() {
  const employees = await Employee.find({ 'annualLeave.totalHours': { $exists: true } })
    .select('annualLeave.totalHours annualLeave.usedHours')
    .lean()
  if (dryRun) return employees.length
  const operations = employees.map((employee) => ({
    updateOne: {
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

async function main() {
  await connectDB(process.env.MONGODB_URI)
  if (rollback) {
    const count = await rollbackToDays()
    console.log(`${dryRun ? 'Would write' : 'Wrote'} totalDays/usedDays (hours / 8) for ${count} employees`)
  } else if (dryRun) {
    const { pending, fromDays, alreadyHours } = await countPending()
    console.log(`Would migrate annual leave to hours for ${pending} employees (days x8: ${fromDays}, already hours: ${alreadyHours})`)
  } else {
    const result = await migrateAnnualLeaveToHours()
    console.log(
      `Migrated annual leave to hours for ${result.migrated} employees ` +
      `(days x8: ${result.fromDays}, already hours: ${result.alreadyHours}, repaired: ${result.repaired})`
    )
  }
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('Annual leave migration failed', error?.name ?? 'Error')
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
