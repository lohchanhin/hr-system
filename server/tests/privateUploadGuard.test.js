import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import { jest } from '@jest/globals'
import privateUploadGuard from '../src/middleware/privateUploadGuard.js'

// 用真的 express.static 驗證：它會先解碼路徑再讀檔，所以用編碼過的路徑也不可繞過守衛
let root
let app

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-upload-guard-'))
  fs.mkdirSync(path.join(root, 'approvals'))
  fs.mkdirSync(path.join(root, 'employees'))
  fs.mkdirSync(path.join(root, 'public'))
  fs.writeFileSync(path.join(root, 'approvals', 'proof.pdf'), '%PDF-1.4 secret')
  fs.writeFileSync(path.join(root, 'employees', 'employee_photo.png'), 'png-secret')
  fs.writeFileSync(path.join(root, 'employee_legacy.png'), 'legacy-secret')
  fs.writeFileSync(path.join(root, 'public', 'logo.png'), 'logo')
  fs.writeFileSync(path.join(root, 'logo.png'), 'root-logo')
  app = express()
  app.use('/upload', privateUploadGuard, express.static(root))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('privateUploadGuard against the real static handler', () => {
  it('serves public assets', async () => {
    const res = await request(app).get('/upload/logo.png')
    expect(res.status).toBe(200)
    const nested = await request(app).get('/upload/public/logo.png')
    expect(nested.status).toBe(200)
  })

  it.each([
    '/upload/approvals/proof.pdf',
    '/upload/employees/employee_photo.png',
    '/upload/employee_legacy.png',
  ])('blocks the plain path %s', async (url) => {
    const res = await request(app).get(url)
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('secret')
  })

  it.each([
    ['percent-encoded directory name', '/upload/%61pprovals/proof.pdf'],
    ['encoded slash', '/upload/approvals%2fproof.pdf'],
    ['encoded slash after a decoy segment', '/upload/public/..%2fapprovals%2fproof.pdf'],
    ['upper-case directory', '/upload/APPROVALS/proof.pdf'],
    ['mixed case directory', '/upload/Approvals/proof.pdf'],
    ['encoded backslash separator', '/upload/approvals%5cproof.pdf'],
    ['encoded employees directory', '/upload/%65mployees/employee_photo.png'],
    ['encoded legacy photo', '/upload/%65mployee_legacy.png'],
    ['upper-case legacy photo', '/upload/EMPLOYEE_LEGACY.png'],
    ['double slash', '/upload//approvals/proof.pdf'],
    ['dot segment', '/upload/./approvals/proof.pdf'],
    ['trailing dot on the directory', '/upload/approvals./proof.pdf'],
    ['encoded dot-dot traversal', '/upload/public/%2e%2e/approvals/proof.pdf'],
  ])('blocks %s', async (_label, url) => {
    const res = await request(app).get(url)
    expect(res.status).toBe(404)
    expect(res.text).not.toContain('secret')
  })

  it('rejects malformed percent sequences instead of throwing', async () => {
    const res = await request(app).get('/upload/%E0%A4%A')
    expect(res.status).toBe(404)
  })

  it('rejects NTFS alternate stream syntax and NUL bytes', async () => {
    expect((await request(app).get('/upload/approvals::$INDEX_ALLOCATION/proof.pdf')).status).toBe(404)
    expect((await request(app).get('/upload/logo.png%00.pdf')).status).toBe(404)
  })
})

describe('privateUploadGuard unit behaviour', () => {
  const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() })

  it('lets non-private paths through without touching the response', () => {
    const res = makeRes()
    const next = jest.fn()
    privateUploadGuard({ path: '/public-logo.png' }, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('does not treat a file that merely starts with the letters as private', () => {
    const next = jest.fn()
    privateUploadGuard({ path: '/approvals-readme.txt' }, makeRes(), next)
    privateUploadGuard({ path: '/employeesheet.png' }, makeRes(), next)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('answers with a JSON 404 for blocked paths', () => {
    const res = makeRes()
    privateUploadGuard({ path: '/%61pprovals/x.pdf' }, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
  })
})
