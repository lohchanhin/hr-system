import request from 'supertest'
import express from 'express'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { MongoMemoryServer } from 'mongodb-memory-server'

import authRoutes from '../src/routes/authRoutes.js'
import Employee from '../src/models/Employee.js'
import { isTokenBlacklisted } from '../src/utils/tokenBlacklist.js'

let app
let mongod
let testEmployee

beforeAll(async () => {
  process.env.JWT_SECRET = 'secret'
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri(), { dbName: 'test' })

  app = express()
  app.use(express.json())
  app.use('/api', authRoutes)
})

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase()
  testEmployee = await Employee.create({
    name: 'John',
    username: 'john',
    password: 'pass',
    role: 'employee'
  })
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

describe('Auth API', () => {
  it('使用正確帳密登入', async () => {
    const signSpy = jest.spyOn(jwt, 'sign')
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.user).toEqual({ id: testEmployee._id.toString(), role: 'employee', username: 'john' })
    expect(signSpy).toHaveBeenCalledWith({ id: testEmployee._id, role: 'employee' }, 'secret', { expiresIn: '1h' })
    signSpy.mockRestore()
  })

  it('使用錯誤密碼登入失敗', async () => {
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('登出後將 token 加入黑名單', async () => {
    const token = jwt.sign({ id: testEmployee._id, role: 'employee' }, 'secret', { expiresIn: '1h' })
    const res = await request(app).post('/api/logout').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(204)
    const result = await isTokenBlacklisted(token)
    expect(result).toBe(true)
  })
})
