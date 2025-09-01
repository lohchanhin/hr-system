import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import Organization from '../src/models/Organization.js'
import Employee from '../src/models/Employee.js'
import User from '../src/models/User.js'

dotenv.config()

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined')
  process.exit(1)
}

async function migrate() {
  await connectDB(process.env.MONGODB_URI)

  const orgs = await Organization.find()

  for (const org of orgs) {
    await Employee.updateMany({ organization: org.name }, { organization: org._id })
    await User.updateMany({ organization: org.name }, { organization: org._id })
  }

  await mongoose.disconnect()
  console.log('Organization ID migration completed')
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
