const invalidTokens = new Set()

export function blacklistToken(token) {
  if (token) invalidTokens.add(token)
}

export function isTokenBlacklisted(token) {
  return invalidTokens.has(token)
}
