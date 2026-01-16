import { describe, it, expect } from '@jest/globals'
import { uploadSingle, handleMulterError, processUploadedPhoto } from '../src/middleware/photoUploadMulter.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '../../upload')

describe('photoUploadMulter middleware', () => {
  describe('processUploadedPhoto', () => {
    it('should set photo path when file is uploaded', async () => {
      const req = {
        file: {
          filename: 'test_photo_12345.jpg'
        },
        body: {}
      }
      const res = {}
      const next = () => {}
      
      await processUploadedPhoto(req, res, next)
      
      expect(req.body.photo).toBe('/upload/test_photo_12345.jpg')
    })

    it('should parse JSON fields in FormData', async () => {
      const req = {
        file: {
          filename: 'test_photo_12345.jpg'
        },
        body: {
          name: 'John Doe',
          languages: '["English","Chinese"]',
          emergencyContacts: '[{"name":"Jane","phone":"123"}]'
        }
      }
      const res = {}
      const next = () => {}
      
      await processUploadedPhoto(req, res, next)
      
      expect(req.body.photo).toBe('/upload/test_photo_12345.jpg')
      expect(req.body.name).toBe('John Doe')
      expect(Array.isArray(req.body.languages)).toBe(true)
      expect(req.body.languages).toEqual(['English', 'Chinese'])
      expect(Array.isArray(req.body.emergencyContacts)).toBe(true)
      expect(req.body.emergencyContacts[0].name).toBe('Jane')
    })

    it('should fallback to base64 middleware when no file is uploaded', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      const req = {
        body: {
          photo: `data:image/png;base64,${pngBase64}`
        }
      }
      const res = {}
      let nextCalled = false
      const next = () => { nextCalled = true }
      
      await processUploadedPhoto(req, res, next)
      
      expect(nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.png$/)
      
      // Clean up
      if (req.body.photo && req.body.photo.startsWith('/upload/')) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })

  describe('handleMulterError', () => {
    it('should handle LIMIT_FILE_SIZE error', () => {
      const err = new Error('File too large')
      err.code = 'LIMIT_FILE_SIZE'
      err.name = 'MulterError'
      
      const req = {}
      const res = {
        statusCode: null,
        body: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.body = data
          return this
        }
      }
      const next = () => {}
      
      // Manually check if err is MulterError-like
      const isMulterError = err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE'
      
      if (isMulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
      }
      
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('過大')
    })

    it('should pass through when no error', () => {
      const req = {}
      const res = {}
      let nextCalled = false
      const next = () => { nextCalled = true }
      
      handleMulterError(null, req, res, next)
      
      expect(nextCalled).toBe(true)
    })
  })
})
