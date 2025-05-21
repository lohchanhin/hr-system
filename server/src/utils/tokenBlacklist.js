import jwt from 'jsonwebtoken';
import BlacklistedToken from '../models/BlacklistedToken.js';

export async function blacklistToken(token) {
  if (!token) return;
  const decoded = jwt.decode(token);
  const exp = decoded?.exp;
  const expiresAt = exp ? new Date(exp * 1000) : new Date();
  await BlacklistedToken.create({ token, expiresAt });
}

export async function isTokenBlacklisted(token) {
  if (!token) return false;
  const existing = await BlacklistedToken.findOne({ token, expiresAt: { $gt: new Date() } });
  return !!existing;
}
