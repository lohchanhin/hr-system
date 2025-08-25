import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import Department from '../src/models/Department.js'
import SubDepartment from '../src/models/SubDepartment.js'
import Employee from '../src/models/Employee.js'
import User from '../src/models/User.js'

dotenv.config()

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined')
  process.exit(1)
}

async function migrate() {
  await connectDB(process.env.MONGODB_URI)

  const employees = await Employee.find()

  for (const emp of employees) {
    let deptId = emp.department
    let subDeptId = emp.subDepartment

    // convert department name to ObjectId
    if (deptId && !mongoose.Types.ObjectId.isValid(deptId)) {
      const dept = await Department.findOne({ name: deptId })
      if (dept) deptId = dept._id
    }

    // convert subDepartment name to ObjectId
    if (subDeptId && !mongoose.Types.ObjectId.isValid(subDeptId)) {
      const query = {}
      if (deptId) query.department = deptId
      query.name = subDeptId
      const sub = await SubDepartment.findOne(query)
      if (sub) subDeptId = sub._id
    }

    emp.department = deptId
    emp.subDepartment = subDeptId
    await emp.save()

    await User.updateMany(
      { employee: emp._id },
      { department: deptId, subDepartment: subDeptId }
    )
  }

  await mongoose.disconnect()
  console.log('Migration completed')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

