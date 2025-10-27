const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 8MB：含檔案與欄位

function trimBufferCRLF(buffer) {
  let end = buffer.length
  if (end >= 2 && buffer[end - 2] === 13 && buffer[end - 1] === 10) {
    end -= 2
  }
  return buffer.slice(0, end)
}

function parseContentDisposition(header = '') {
  const result = {}
  header
    .split(';')
    .map(part => part.trim())
    .forEach(part => {
      const [key, rawValue] = part.split('=')
      if (!rawValue) return
      const value = rawValue.replace(/^"|"$/g, '')
      result[key.toLowerCase()] = value
    })
  return result
}

function parseMultipartBody(buffer, boundaryKey) {
  const boundary = `--${boundaryKey}`
  const raw = buffer.toString('binary')
  const segments = raw.split(boundary).slice(1, -1)

  const fields = {}
  let file = null

  segments.forEach(segment => {
    if (!segment) return
    let partBuffer = Buffer.from(segment, 'binary')
    if (partBuffer.length >= 2 && partBuffer[0] === 13 && partBuffer[1] === 10) {
      partBuffer = partBuffer.slice(2)
    }
    const headerDelimiter = Buffer.from('\r\n\r\n')
    const headerEnd = partBuffer.indexOf(headerDelimiter)
    if (headerEnd === -1) return

    const headerSection = partBuffer.slice(0, headerEnd).toString('utf8')
    let bodyBuffer = partBuffer.slice(headerEnd + headerDelimiter.length)
    bodyBuffer = trimBufferCRLF(bodyBuffer)

    const headers = {}
    headerSection
      .split('\r\n')
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => {
        const idx = line.indexOf(':')
        if (idx === -1) return
        const key = line.slice(0, idx).trim().toLowerCase()
        const value = line.slice(idx + 1).trim()
        headers[key] = value
      })

    const disposition = parseContentDisposition(headers['content-disposition'])
    const fieldName = disposition.name
    if (!fieldName) return

    if (Object.prototype.hasOwnProperty.call(disposition, 'filename') && disposition.filename) {
      if (!bodyBuffer.length) return
      file = {
        fieldname: fieldName,
        originalname: disposition.filename,
        encoding: '7bit',
        mimetype: headers['content-type'] || 'application/octet-stream',
        size: bodyBuffer.length,
        buffer: bodyBuffer,
      }
    } else {
      const value = bodyBuffer.toString('utf8')
      fields[fieldName] = value
    }
  })

  return { fields, file }
}

export default function uploadMiddleware(req, res, next) {
  if (req.file) {
    next()
    return
  }

  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundaryMatch) {
    res.status(400).json({ message: 'Content-Type 必須為 multipart/form-data' })
    return
  }

  const boundaryKey = boundaryMatch[1] || boundaryMatch[2]
  const chunks = []
  let totalLength = 0
  let handled = false

  const cleanup = () => {
    req.removeListener('data', onData)
    req.removeListener('end', onEnd)
    req.removeListener('error', onError)
    req.removeListener('close', onClose)
  }

  const abortWithError = (status, message) => {
    if (handled) return
    handled = true
    cleanup()
    if (!res.headersSent) {
      res.status(status).json({ message })
    }
  }

  const onData = (chunk) => {
    totalLength += chunk.length
    if (totalLength > MAX_UPLOAD_SIZE) {
      abortWithError(413, '上傳檔案過大')
      req.destroy()
      return
    }
    chunks.push(chunk)
  }

  const onEnd = () => {
    if (handled) return
    handled = true
    cleanup()

    const buffer = Buffer.concat(chunks)
    try {
      const { fields, file } = parseMultipartBody(buffer, boundaryKey)
      if (!file || file.fieldname !== 'file') {
        res.status(400).json({ message: '缺少上傳檔案' })
        return
      }
      req.file = file
      req.body = { ...(req.body || {}), ...fields }
      next()
    } catch (error) {
      next(error)
    }
  }

  const onError = (error) => {
    if (handled) return
    handled = true
    cleanup()
    next(error)
  }

  const onClose = () => {
    if (handled) return
    handled = true
    cleanup()
  }

  req.on('data', onData)
  req.on('end', onEnd)
  req.on('error', onError)
  req.on('close', onClose)
}
