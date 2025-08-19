import request from 'supertest'
import express from 'express'

let app
let roleRoutes

beforeAll(async () => {
  roleRoutes = (await import('../src/routes/roleRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use('/api/roles', roleRoutes)
})

describe('Role API', () => {
  it('lists roles', async () => {
    const res = await request(app).get('/api/roles')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'employee', name: '員工' },
      { id: 'supervisor', name: '主管' },
      { id: 'admin', name: '管理員' }
    ])
  })
})
