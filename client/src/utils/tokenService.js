export let _expiryTimeout = null;

function parseExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

function scheduleRemoval(expiresAt) {
  clearTimeout(_expiryTimeout);
  if (!expiresAt) return;
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    clearToken();
  } else {
    _expiryTimeout = setTimeout(() => {
      clearToken();
    }, delay);
  }
}

export function setToken(token) {
  const expiresAt = parseExp(token);
  localStorage.setItem('token', token);
  if (expiresAt) {
    localStorage.setItem('token_expires', String(expiresAt));
  } else {
    localStorage.removeItem('token_expires');
  }
  scheduleRemoval(expiresAt);
}

export function getToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const expiresAt = parseInt(localStorage.getItem('token_expires') || '0', 10);
  if (expiresAt && Date.now() >= expiresAt) {
    clearToken();
    return null;
  }
  scheduleRemoval(expiresAt);
  return token;
}

export function clearToken() {
  clearTimeout(_expiryTimeout);
  localStorage.removeItem('token');
  localStorage.removeItem('token_expires');
}
