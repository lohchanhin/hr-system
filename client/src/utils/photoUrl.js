import { API_BASE_URL } from '../api'

/**
 * Convert a photo path to a full URL
 * @param {string|null|undefined} photoPath - The photo path (e.g., '/upload/filename.jpg')
 * @returns {string|null} - The full URL or null if no photo
 */
export function getPhotoUrl(photoPath) {
  if (!photoPath) {
    return null
  }

  // If the photo is already a full URL (http:// or https://), return as is
  if (photoPath.startsWith('http://') || photoPath.startsWith('https://')) {
    return photoPath
  }

  // If the photo is a data URL (base64), return as is
  if (photoPath.startsWith('data:')) {
    return photoPath
  }

  // If the photo is a blob URL, return as is
  if (photoPath.startsWith('blob:')) {
    return photoPath
  }

  // If the path starts with /upload/, prepend the API base URL
  if (photoPath.startsWith('/upload/')) {
    return `${API_BASE_URL}${photoPath}`
  }

  // If the path doesn't start with /, prepend /upload/ and API base URL
  if (!photoPath.startsWith('/')) {
    return `${API_BASE_URL}/upload/${photoPath}`
  }

  // For any other path starting with /, prepend API base URL
  return `${API_BASE_URL}${photoPath}`
}

/**
 * Convert a full photo URL back to a relative path for storage
 * @param {string|null|undefined} photoUrl - The photo URL (full or relative)
 * @returns {string} - The relative path (e.g., '/upload/filename.jpg') or empty string
 */
export function getPhotoPath(photoUrl) {
  if (!photoUrl) {
    return ''
  }

  // If it's a data URL or blob URL, return as is (will be processed by backend)
  if (photoUrl.startsWith('data:') || photoUrl.startsWith('blob:')) {
    return photoUrl
  }

  // If it's already a relative path starting with /upload/, return as is
  if (photoUrl.startsWith('/upload/')) {
    return photoUrl
  }

  // If it's a full URL, extract the path part
  if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
    try {
      const url = new URL(photoUrl)
      const pathname = url.pathname
      // If the pathname contains /upload/, extract from /upload/ onwards
      if (pathname.includes('/upload/')) {
        const uploadIndex = pathname.indexOf('/upload/')
        return pathname.substring(uploadIndex)
      }
      // If it's just the pathname, return it
      if (pathname.startsWith('/')) {
        return pathname
      }
    } catch (e) {
      // Invalid URL, return as is
      return photoUrl
    }
  }

  // For any other case, return as is
  return photoUrl
}
