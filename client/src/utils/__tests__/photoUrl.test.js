import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchEmployeePhotoUrl, getPhotoUrl, getPhotoPath } from '../photoUrl'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

// Mock the API module
vi.mock('../../api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  apiFetch: apiFetchMock,
}))

beforeEach(() => {
  apiFetchMock.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:protected-photo'),
  })
})

describe('fetchEmployeePhotoUrl', () => {
  it('loads a protected employee photo through apiFetch', async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/png' })),
    })

    await expect(fetchEmployeePhotoUrl('emp/1', '/upload/employees/photo.png'))
      .resolves.toBe('blob:protected-photo')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/employees/emp%2F1/photo',
      {},
      { autoRedirect: false },
    )
  })

  it('does not create a URL when access is denied', async () => {
    apiFetchMock.mockResolvedValue({ ok: false })

    await expect(fetchEmployeePhotoUrl('emp2', '/upload/employees/photo.png'))
      .resolves.toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

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

describe('getPhotoPath', () => {
  it('should return empty string for null or undefined input', () => {
    expect(getPhotoPath(null)).toBe('')
    expect(getPhotoPath(undefined)).toBe('')
    expect(getPhotoPath('')).toBe('')
  })

  it('should return data URLs as is', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    expect(getPhotoPath(dataUrl)).toBe(dataUrl)
  })

  it('should return blob URLs as is', () => {
    const blobUrl = 'blob:http://localhost:3000/abc123'
    expect(getPhotoPath(blobUrl)).toBe(blobUrl)
  })

  it('should return relative paths starting with /upload/ as is', () => {
    const path = '/upload/employee_123456.jpg'
    expect(getPhotoPath(path)).toBe(path)
  })

  it('should extract relative path from full HTTP URLs', () => {
    const url = 'http://localhost:3000/upload/employee_123456.jpg'
    expect(getPhotoPath(url)).toBe('/upload/employee_123456.jpg')
  })

  it('should extract relative path from full HTTPS URLs', () => {
    const url = 'https://example.com/upload/employee_123456.jpg'
    expect(getPhotoPath(url)).toBe('/upload/employee_123456.jpg')
  })

  it('should handle URLs with /upload/ in the middle of pathname', () => {
    const url = 'http://localhost:3000/api/upload/employee_123456.jpg'
    expect(getPhotoPath(url)).toBe('/upload/employee_123456.jpg')
  })

  it('should return pathname for URLs without /upload/', () => {
    const url = 'http://localhost:3000/images/photo.jpg'
    expect(getPhotoPath(url)).toBe('/images/photo.jpg')
  })

  it('should handle invalid URLs gracefully', () => {
    const invalidUrl = 'not-a-valid-url'
    expect(getPhotoPath(invalidUrl)).toBe(invalidUrl)
  })
})
