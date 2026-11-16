/**
 * Pick only allowed keys from a request payload (prevents Mass Assignment).
 * Rejects prototype-polluting keys and only copies own enumerable properties
 * whose values are not undefined.
 */
export function pickAllowedFields(source, allowedKeys = []) {
  const result = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return result;
  }
  for (const key of allowedKeys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Respond with a safe, sanitized error payload without leaking internal
 * stack traces, database details, or raw error messages on unexpected 500s.
 */
export function sendSafeError(
  req,
  res,
  err,
  {
    defaultStatus = 500,
    defaultMessage = '系統處理失敗，請稍後再試',
    validationMessage = '請求資料格式或欄位驗證失敗',
  } = {},
) {
  const requestId = req?.requestId || req?.id;

  if (err?.name === 'ValidationError' || err?.name === 'CastError') {
    return res.status(400).json({
      error: validationMessage,
      ...(requestId ? { requestId } : {}),
    });
  }

  if (err?.code === 11000) {
    return res.status(409).json({
      error: '資料已存在，請勿重複建立',
      ...(requestId ? { requestId } : {}),
    });
  }

  if (err?.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      error: err.exposeMessage || validationMessage,
      ...(requestId ? { requestId } : {}),
    });
  }

  console.error('controller_error', {
    requestId,
    errorName: err?.name || 'Error',
    code: err?.code,
  });

  return res.status(defaultStatus).json({
    error: defaultMessage,
    ...(requestId ? { requestId } : {}),
  });
}
