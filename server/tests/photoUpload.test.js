import { describe, it, expect, beforeEach } from '@jest/globals'
import photoUploadMiddleware from '../src/middleware/photoUpload.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '../../upload')

describe('photoUpload middleware', () => {
  let req, res, next

  beforeEach(() => {
    req = { body: {} }
    res = {
      status: function(code) {
        this.statusCode = code
        return this
      },
      json: function(data) {
        this.body = data
        return this
      }
    }
    next = () => { res.nextCalled = true }
  })

  describe('when no photo is provided', () => {
    it('should call next without processing', async () => {
      await photoUploadMiddleware(req, res, next)
      expect(res.nextCalled).toBe(true)
    })
  })

  describe('when photo is already uploaded (starts with /upload/)', () => {
    it('should call next without processing', async () => {
      req.body.photo = '/upload/existing_photo.jpg'
      await photoUploadMiddleware(req, res, next)
      expect(res.nextCalled).toBe(true)
    })
  })

  describe('when blob URL is provided', () => {
    it('should reject with clear error message', async () => {
      req.body.photo = 'blob:http://example.com/12345'
      await photoUploadMiddleware(req, res, next)
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('blob URL')
    })

    it('should reject blob URL in photoList', async () => {
      req.body.photoList = ['blob:http://example.com/12345']
      await photoUploadMiddleware(req, res, next)
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('blob URL')
    })
  })

  describe('when valid base64 PNG data is provided with data URI prefix', () => {
    it('should save the file and set photo path', async () => {
      // 1x1 transparent PNG
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      req.body.photo = `data:image/png;base64,${pngBase64}`
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.png$/)
      
      // Clean up - delete the created file
      if (req.body.photo) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })

  describe('when valid base64 JPEG data is provided with data URI prefix', () => {
    it('should save the file with .jpg extension', async () => {
      // Minimal JPEG (1x1 black pixel)
      const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k='
      req.body.photo = `data:image/jpeg;base64,${jpegBase64}`
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.jpg$/)
      
      // Clean up
      if (req.body.photo) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })

  describe('when valid raw base64 PNG data is provided without data URI prefix', () => {
    it('should detect format and save the file', async () => {
      // 1x1 transparent PNG
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      req.body.photo = pngBase64
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.png$/)
      
      // Clean up
      if (req.body.photo) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })

  describe('when photoList is provided', () => {
    it('should use first photo from photoList', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      req.body.photoList = [`data:image/png;base64,${pngBase64}`]
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.png$/)
      
      // Clean up
      if (req.body.photo) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })

  describe('when invalid image data is provided without data URI prefix', () => {
    it('should reject with invalid format error', async () => {
      // Valid base64 but not a valid image format (no data URI prefix, so format detection will run)
      req.body.photo = 'aGVsbG8gd29ybGQ='
      await photoUploadMiddleware(req, res, next)
      
      // Should fail format detection since the data doesn't represent a valid image
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('無效的圖片數據')
    })
  })

  describe('when unsupported image format is provided', () => {
    it('should reject with format error', async () => {
      // SVG is not supported
      const svgData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg=='
      req.body.photo = svgData
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('支援')
    })
  })

  describe('when file is too large', () => {
    it('should reject with file size error', async () => {
      // Create a base64 string that's over 5MB when decoded
      const largeData = 'A'.repeat(7 * 1024 * 1024) // 7MB of 'A's
      req.body.photo = `data:image/png;base64,${largeData}`
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toContain('過大')
    })
  })

  describe('when photoData is provided instead of photo', () => {
    it('should process photoData field', async () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      req.body.photoData = `data:image/png;base64,${pngBase64}`
      
      await photoUploadMiddleware(req, res, next)
      
      expect(res.nextCalled).toBe(true)
      expect(req.body.photo).toMatch(/^\/upload\/employee_\d+_[a-f0-9]+\.png$/)
      
      // Clean up
      if (req.body.photo) {
        const filepath = path.join(UPLOAD_DIR, path.basename(req.body.photo))
        await fs.unlink(filepath).catch(() => {})
      }
    })
  })
})
