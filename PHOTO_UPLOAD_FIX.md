# Photo Upload Implementation - Fixed Payload Too Large Issue

## Problem Solved

Previously, the HR system converted uploaded photos to base64 format before sending them to the server. This caused several issues:
- **Payload Too Large errors** when uploading photos larger than ~3-4MB
- Base64 encoding increases file size by approximately 33%
- Large JSON payloads consuming excessive memory
- Poor performance for photo uploads

## Solution

Implemented direct file upload using multer middleware:
- Photos are now sent as `multipart/form-data` instead of base64 in JSON
- Files are uploaded directly to the `/upload` folder
- Only the file path (e.g., `/upload/employee_1234567890_a1b2c3d4.jpg`) is stored in the database
- Maximum file size: 5MB
- Supported formats: JPEG, PNG, GIF, WebP

## How It Works

### Frontend (Client)
1. User selects a photo using the file picker
2. The `handlePhotoRequest` function creates an Object URL for preview and stores the raw File object
3. When saving, `saveEmployee` checks if there's a new photo file:
   - **With new photo**: Sends FormData with the photo file and other employee data
   - **Without new photo**: Sends JSON payload (backward compatible)

### Backend (Server)
1. Multer middleware (`photoUploadMulter.js`) intercepts the request
2. If a file is present:
   - Validates file type and size
   - Generates a unique filename using timestamp and random bytes
   - Saves file to `/upload` directory
   - Sets `req.body.photo` to the file path
3. If no file but base64 data present (old method):
   - Falls back to the original `photoUpload.js` middleware
   - Maintains backward compatibility

### Routes
```javascript
// Employee creation with photo
POST /api/employees
Content-Type: multipart/form-data
- photo: (file)
- name: "John Doe"
- email: "john@example.com"
- ... (other fields)

// Employee update with photo
PUT /api/employees/:id
Content-Type: multipart/form-data
- photo: (file)
- ... (fields to update)
```

## Backward Compatibility

The implementation maintains full backward compatibility:
- Old base64 format still works (via `photoUpload.js` middleware)
- Existing photos stored as base64 continue to display correctly
- Frontend can fall back to JSON when not uploading a new photo
- Increased Express JSON payload limit to 50MB for legacy support

## File Organization

```
hr-system/
├── upload/                          # Photo storage directory
│   ├── .gitkeep                    # Keeps directory in git
│   └── employee_*.{jpg,png,gif,webp} # Uploaded photos
├── server/
│   └── src/
│       └── middleware/
│           ├── photoUpload.js      # Legacy base64 handler
│           └── photoUploadMulter.js # New multer handler
└── client/
    └── src/
        └── components/
            └── backComponents/
                └── EmployeeManagement.vue # Updated upload logic
```

## Security Considerations

### Implemented Protections
1. **File Type Validation**: Only allows image types (JPEG, PNG, GIF, WebP)
2. **File Size Limit**: Maximum 5MB per file
3. **Unique Filenames**: Uses cryptographically secure random bytes to prevent collisions
4. **Authentication Required**: All upload routes require authentication
5. **Authorization**: Only admins can upload/modify employee photos
6. **Path Traversal Prevention**: Multer automatically sanitizes filenames

### Security Notes from CodeQL
- Rate limiting is recommended for file upload endpoints (pre-existing architectural consideration)
- Current protection relies on authentication and admin authorization
- Consider implementing rate limiting in a future update

## Testing

### Unit Tests
- `photoUploadMulter.test.js`: Tests for new multer middleware (5 tests)
- `photoUpload.test.js`: Tests for legacy base64 middleware (12 tests)
- All tests passing ✓

### Test Coverage
- File upload with valid image
- File upload with invalid format
- File size limit enforcement
- JSON field parsing in FormData
- Backward compatibility with base64
- Error handling

## Usage Example

### Creating Employee with Photo
```javascript
const formData = new FormData()
formData.append('photo', photoFile) // File object from input
formData.append('name', 'John Doe')
formData.append('email', 'john@example.com')
formData.append('username', 'johndoe')
formData.append('password', 'securepassword')
// ... other fields

const response = await fetch('/api/employees', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
})
```

### Updating Employee Photo
```javascript
const formData = new FormData()
formData.append('photo', newPhotoFile)
// Only include fields to update
formData.append('name', 'John Doe Updated')

const response = await fetch(`/api/employees/${employeeId}`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
})
```

## Benefits

1. **Eliminates Payload Too Large Errors**: Files are streamed directly, not embedded in JSON
2. **Better Performance**: ~33% smaller payload (no base64 encoding)
3. **Scalability**: Can handle larger photos without increasing JSON payload limits
4. **Standard Approach**: Uses industry-standard multipart/form-data
5. **Better Memory Usage**: Streaming upload instead of loading entire base64 in memory
6. **Backward Compatible**: Existing implementations continue to work

## Configuration

### Environment Variables
No new environment variables required. The system uses existing configuration.

### Directory Setup
The `/upload` directory is automatically created by the middleware if it doesn't exist.

### .gitignore
```gitignore
upload/*
!upload/.gitkeep
```

## Migration Path

No migration required! The system automatically:
1. Accepts new multipart/form-data uploads
2. Falls back to base64 for legacy clients
3. Displays existing photos regardless of storage method

## Future Improvements

Potential enhancements (not in current scope):
1. Image compression/optimization
2. Thumbnail generation
3. CDN integration
4. Multiple photo support per employee
5. Rate limiting for upload endpoints
6. Image format conversion
7. Automatic cleanup of orphaned files

## Support

For issues or questions:
1. Check server logs for upload errors
2. Verify `/upload` directory has write permissions
3. Ensure multer is installed (`npm install multer`)
4. Check Express payload limits if using base64 fallback
