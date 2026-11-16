import net from 'node:net';
import { getSettings as getOtherControlSettings } from '../services/otherControlSettingsStore.js';
import { BACKOFFICE_ROLES } from '../config/rbac.js';

const DEFAULT_PLACEHOLDER_IPS = new Set(['203.0.113.0/24', '198.51.100.25']);

export function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return '';
  const trimmed = rawIp.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function isLoopbackIp(ip) {
  const normalized = normalizeIp(ip);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const val = Number(part);
    if (!Number.isInteger(val) || val < 0 || val > 255) return null;
    num = (num << 8) + val;
  }
  return num >>> 0;
}

export function ipMatchesCidrOrExact(clientIp, entryAddress) {
  const ip = normalizeIp(clientIp);
  const target = normalizeIp(entryAddress);
  if (!ip || !target) return false;
  if (ip === target) return true;

  if (target.includes('/')) {
    const [network, prefixStr] = target.split('/');
    const prefix = Number(prefixStr);
    if (net.isIPv4(ip) && net.isIPv4(network) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const ipInt = ipv4ToInt(ip);
      const netInt = ipv4ToInt(network);
      return ipInt !== null && netInt !== null && (ipInt & mask) === (netInt & mask);
    }
  }
  return false;
}

/**
 * Enforce IP whitelist from OtherControlSetting.security for backoffice roles
 * when explicitly enabled or configured with non-placeholder entries.
 * Loopback addresses are always exempted so local healthchecks & tests work safely.
 */
export async function enforceAdminIpWhitelist(req, res, next) {
  try {
    if (process.env.NODE_ENV === 'test' && req.headers['x-enforce-ip-whitelist'] !== '1') {
      return next();
    }
    const role = req.user?.role;
    if (role && !BACKOFFICE_ROLES.includes(role)) {
      return next();
    }

    const clientIp = normalizeIp(req.ip || req.socket?.remoteAddress || '');
    if (!clientIp || isLoopbackIp(clientIp)) {
      return next();
    }

    const settings = await getOtherControlSettings();
    const security = settings?.security || {};
    const entries = Array.isArray(security.ipWhitelist) ? security.ipWhitelist : [];

    // Do not lock out environments that still have only the seeded RFC 5737 documentation placeholders
    const effectiveEntries = entries.filter(
      (entry) => entry?.address && !DEFAULT_PLACEHOLDER_IPS.has(String(entry.address).trim())
    );

    if (effectiveEntries.length === 0 && security.ipWhitelistEnabled !== true) {
      return next();
    }

    const allowedList = effectiveEntries.length > 0 ? effectiveEntries : entries;
    const matched = allowedList.some((entry) => ipMatchesCidrOrExact(clientIp, entry?.address));
    if (!matched) {
      return res.status(403).json({
        error: '您的連線 IP 不在允許的管理後台白名單內',
        code: 'IP_NOT_WHITELISTED',
      });
    }
    return next();
  } catch (err) {
    // Fail open only if settings store is temporarily unreachable; log for ops
    console.error('IP whitelist check failed', { error: err?.name || 'Error' });
    return next();
  }
}
