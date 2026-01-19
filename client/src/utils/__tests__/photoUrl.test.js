import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getPhotoUrl } from '../photoUrl'

// Mock the API module
vi.mock('../../api', () => ({
  API_BASE_URL: 'http://localhost:3000'
}))

describe('getPhotoUrl', () => {
  it('should return null for null or undefined input', () => {
    expect(getPhotoUrl(null)).toBe(null)
    expect(getPhotoUrl(undefined)).toBe(null)
    expect(getPhotoUrl('')).toBe(null)
  })

  it('should return full HTTP URLs as is', () => {
    const url = 'http://example.com/photo.jpg'
    expect(getPhotoUrl(url)).toBe(url)
  })

  it('should return full HTTPS URLs as is', () => {
    const url = 'https://example.com/photo.jpg'
    expect(getPhotoUrl(url)).toBe(url)
  })

  it('should return data URLs as is', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    expect(getPhotoUrl(dataUrl)).toBe(dataUrl)
  })

  it('should return blob URLs as is', () => {
    const blobUrl = 'blob:http://localhost:3000/abc123'
    expect(getPhotoUrl(blobUrl)).toBe(blobUrl)
  })

  it('should prepend API_BASE_URL for paths starting with /upload/', () => {
    const path = '/upload/employee_123456.jpg'
    expect(getPhotoUrl(path)).toBe('http://localhost:3000/upload/employee_123456.jpg')
  })

  it('should handle paths without leading slash', () => {
    const path = 'employee_123456.jpg'
    expect(getPhotoUrl(path)).toBe('http://localhost:3000/upload/employee_123456.jpg')
  })

  it('should prepend API_BASE_URL for other absolute paths', () => {
    const path = '/images/photo.jpg'
    expect(getPhotoUrl(path)).toBe('http://localhost:3000/images/photo.jpg')
  })
})
