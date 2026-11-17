import { clearRoleCache } from './roleCache'

/*
 * 登入用的 access token（15 分鐘有效）。到期時不刪除：以前到期就清掉 token，
 * api.js 看不到 token 就不續期，路由守衛也把人踢回登入頁，填到一半的表單整個不見。
 * 現在到期的 token 留著，下一次呼叫 API 前由 api.js 用續期 cookie 換新的；續期失敗才登出。
 */

function parseExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

export function setToken(token) {
  clearRoleCache();
  const expiresAt = parseExp(token);
  localStorage.setItem('token', token);
  if (expiresAt) {
    localStorage.setItem('token_expires', String(expiresAt));
  } else {
    localStorage.removeItem('token_expires');
  }
}

/** 目前的 token（可能已過期，過期的由 api.js 續期） */
export function getToken() {
  return localStorage.getItem('token') || null;
}

/** token 到期的時間（毫秒）；沒有 token 或讀不到到期時間時為 0 */
export function getTokenExpiresAt() {
  const stored = parseInt(localStorage.getItem('token_expires') || '0', 10);
  if (stored) return stored;
  const token = getToken();
  return token ? parseExp(token) || 0 : 0;
}

/** token 已過期，或在 marginMs 毫秒內就會過期 */
export function isTokenExpiring(marginMs = 0) {
  const expiresAt = getTokenExpiresAt();
  return Boolean(expiresAt) && Date.now() + marginMs >= expiresAt;
}

export function clearToken() {
  clearRoleCache();
  localStorage.removeItem('token');
  localStorage.removeItem('token_expires');
}
