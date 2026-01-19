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
