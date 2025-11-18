import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import AttendanceSetting from '../src/models/AttendanceSetting.js'

dotenv.config()

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined')
  process.exit(1)
}

const legacyBreakSettingSchema = new mongoose.Schema(
  {
    department: mongoose.Schema.Types.ObjectId,
    subDepartment: mongoose.Schema.Types.ObjectId,
    enableGlobalBreak: Boolean,
    breakMinutes: Number,
    allowMultiBreak: Boolean,
  },
  { collection: 'breaksettings' }
)

const LegacyBreakSetting = mongoose.model('LegacyBreakSetting', legacyBreakSettingSchema)

function fallbackBreakSetting(current = {}) {
  return {
    enableGlobalBreak: current.enableGlobalBreak ?? false,
    breakMinutes: current.breakMinutes ?? 60,
    allowMultiBreak: current.allowMultiBreak ?? false,
  }
}

async function migrate() {
  await connectDB(process.env.MONGODB_URI)

  let attendance = await AttendanceSetting.findOne()
  if (!attendance) {
    attendance = await AttendanceSetting.create({
      shifts: [],
      globalBreakSetting: fallbackBreakSetting(),
    })
  }

  const legacySettings = await LegacyBreakSetting.find()
  const sourceSetting = legacySettings.find((item) => item.enableGlobalBreak) || legacySettings[0]

  if (sourceSetting) {
    const mergedGlobal = fallbackBreakSetting(attendance.globalBreakSetting)
    attendance.globalBreakSetting = {
      ...mergedGlobal,
      enableGlobalBreak: Boolean(sourceSetting.enableGlobalBreak),
      breakMinutes: sourceSetting.breakMinutes ?? mergedGlobal.breakMinutes,
      allowMultiBreak: sourceSetting.allowMultiBreak ?? mergedGlobal.allowMultiBreak,
    }

    if (Array.isArray(attendance.shifts)) {
      for (const shift of attendance.shifts) {
        if (shift.breakMinutes == null && sourceSetting.breakMinutes != null) {
          shift.breakMinutes = sourceSetting.breakMinutes
        }
        if (shift.allowMultiBreak == null && sourceSetting.allowMultiBreak != null) {
          shift.allowMultiBreak = Boolean(sourceSetting.allowMultiBreak)
        }
      }
    }
  } else if (!attendance.globalBreakSetting) {
    attendance.globalBreakSetting = fallbackBreakSetting()
  }

  await attendance.save()
  const { enableGlobalBreak, breakMinutes, allowMultiBreak } = fallbackBreakSetting(
    attendance.globalBreakSetting
  )
  console.log(
    `Updated attendance setting with break defaults: enableGlobalBreak=${enableGlobalBreak}, breakMinutes=${breakMinutes}, allowMultiBreak=${allowMultiBreak}`
  )
  console.log(`Shift records updated: ${attendance.shifts?.length ?? 0}`)

  await mongoose.disconnect()
  console.log('Break setting migration completed')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
