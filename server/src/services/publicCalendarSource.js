/**
 * 政府辦公日曆表的下載、解碼與驗證（只有行事曆匯入與「檢查更新」會用到網路；排班、薪資計算時一律不連網路）。
 *
 * 主要來源：政府資料開放平臺 dataset 14718（行政院人事行政總處「中華民國政府行政機關辦公日曆表」）。
 *   下載網址每次重新上傳都會變，唯一穩定的是 dataset 的 metadata API，所以每次都從 metadata 找檔案。
 *   檔案編碼不固定（多數是 UTF-8 含 BOM，114 年更新版是 Big5），一律依內容判斷，不相信宣告的編碼。
 * 備援來源：ruyut/TaiwanCalendar（同一份資料的 JSON 版），固定在特定 commit，不使用會變動的分支網址。
 */
import { createHash } from 'node:crypto';
import { toTaipeiDateKey } from '../utils/taipeiTime.js';

export const DGPA_DATASET_URL = 'https://data.gov.tw/api/v2/rest/dataset/14718';
const USER_AGENT = 'hr-system-holiday-sync';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_BY_CHAR = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const CSV_HEADER = ['西元日期', '星期', '是否放假', '備註'];
export const MIN_CALENDAR_YEAR = 2017;

// PR #7 合併（2026-09-09）的 commit：含 2017–2027 年，2025（1141020 更新版）、2026、2027 與政府資料逐日相同
export const RUYUT_PINNED_COMMIT = '73d814e768c94f2426af0787c96658d69068c3ff';

export function ruyutUrl(year) {
  return `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar@${RUYUT_PINNED_COMMIT}/data/${year}.json`;
}

// 驗證失敗的代碼（資料有問題，不是連線問題）
export const CALENDAR_VALIDATION_CODES = [
  'BAD_HEADER', 'WRONG_YEAR', 'ROW_COUNT', 'NOT_CONTINUOUS', 'BAD_VALUE', 'BAD_WEEKDAY',
  'BAD_JSON', 'ENCODING_UNSUPPORTED',
];

function codedError(code, message = code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function isValidationError(error) {
  return CALENDAR_VALIDATION_CODES.includes(error?.code);
}

/** 目前台灣年度 */
export function currentTaipeiYear(now = new Date()) {
  return Number(String(toTaipeiDateKey(now)).slice(0, 4));
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw codedError('FETCH_TIMEOUT');
    throw codedError('FETCH_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

function stripBom(text) {
  return String(text ?? '').replace(/^﻿/, '');
}

/**
 * 從 dataset 14718 的 metadata 找出每日格式（西元日期,星期,是否放假,備註）的檔案。
 * 回傳 { metadataModifiedDate, resources: [{ rocYear, year, description, url, declaredEncoding, uploadFolder, recommended }] }。
 * 同一年度有多份檔案時是「衝突」，不自動選；recommended 只是建議（描述含「更新」「修正」者，其次是上傳月份最新者）。
 */
export async function discoverDgpaResources({ fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const response = await fetchWithTimeout(fetchImpl, DGPA_DATASET_URL, {
    timeoutMs,
    headers: { Accept: 'application/json' },
  });
  if (!response?.ok) throw codedError(`HTTP_${response?.status ?? 0}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw codedError('BAD_METADATA');
  }
  const distribution = body?.result?.distribution;
  if (!Array.isArray(distribution)) throw codedError('BAD_METADATA');

  const resources = [];
  for (const item of distribution) {
    const firstField = stripBom(item?.resourceField?.[0]?.name).trim();
    const description = String(item?.resourceDescription ?? '').trim();
    const match = /^(\d{3})年/.exec(description);
    if (firstField !== '西元日期' || !match || !item?.resourceDownloadUrl) continue;
    let url;
    try {
      url = new URL(item.resourceDownloadUrl).href;
    } catch {
      continue;
    }
    const rocYear = Number(match[1]);
    resources.push({
      rocYear,
      year: rocYear + 1911,
      description,
      url,
      declaredEncoding: String(item?.resourceCharacterEncoding ?? ''),
      uploadFolder: (url.match(/dgpa\/files\/(\d{6})\//) || [])[1] || '',
      recommended: false,
    });
  }
  markRecommended(resources);
  return { metadataModifiedDate: String(body?.result?.modifiedDate ?? ''), resources };
}

/** 依年度標記建議的檔案：只有一份就是它；多份時描述含「更新」「修正」者，其次上傳月份最新者，再平手就不建議 */
export function markRecommended(items) {
  const byYear = new Map();
  for (const item of items) {
    if (!byYear.has(item.year)) byYear.set(item.year, []);
    byYear.get(item.year).push(item);
  }
  for (const group of byYear.values()) {
    for (const item of group) item.recommended = false;
    if (group.length === 1) {
      group[0].recommended = true;
      continue;
    }
    const revised = group.filter((item) => /更新|修正/.test(item.description || ''));
    if (revised.length === 1) {
      revised[0].recommended = true;
      continue;
    }
    const pool = revised.length ? revised : group;
    const latest = pool.reduce((max, item) => (String(item.uploadFolder || '') > max ? String(item.uploadFolder || '') : max), '');
    const latestItems = pool.filter((item) => String(item.uploadFolder || '') === latest);
    if (latest && latestItems.length === 1) latestItems[0].recommended = true;
  }
  return items;
}

/** 下載一個檔案（伺服器回應的 Content-Type 是 octet-stream，不看它）。非 2xx 丟出 HTTP_<狀態碼> */
export async function fetchPublicCalendarFile(url, { fetchImpl = fetch, timeoutMs = 30000, maxBytes = 1_000_000 } = {}) {
  const response = await fetchWithTimeout(fetchImpl, url, { timeoutMs });
  if (!response?.ok) throw codedError(`HTTP_${response?.status ?? 0}`);
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw codedError('FETCH_FAILED');
  }
  if (buffer.length > maxBytes) throw codedError('TOO_LARGE');
  return buffer;
}

export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 依內容判斷編碼：EF BB BF -> utf-8-bom；嚴格 UTF-8 解得開 -> utf-8；否則 Big5（Node 內建 full-icu 支援）。
 * Big5 解碼器無法建立時丟出 ENCODING_UNSUPPORTED，呼叫端改用備援來源。
 */
export function decodeCalendarCsv(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // 不是 UTF-8，改用 Big5
  }
  let decoder;
  try {
    decoder = new TextDecoder('big5');
  } catch {
    throw codedError('ENCODING_UNSUPPORTED');
  }
  return { text: decoder.decode(bytes), encoding: 'big5' };
}

function dateKeyFromCompact(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  const key = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) return null;
  return key;
}

/**
 * 驗證一年份的每日資料：每天都在該年度、星期與日期相符、日期從 1/1 起連續不中斷、剛好 365/366 筆。
 * rawRows = [{ date: 'YYYY-MM-DD'|null, weekdayChar, isOff, remark }]
 */
function validateYearRows(rawRows, year) {
  const y = Number(year);
  const rows = [];
  for (const raw of rawRows) {
    if (!raw.date || Number(raw.date.slice(0, 4)) !== y) throw codedError('WRONG_YEAR');
    const weekday = new Date(`${raw.date}T00:00:00.000Z`).getUTCDay();
    if (WEEKDAY_BY_CHAR[raw.weekdayChar] !== weekday) throw codedError('BAD_WEEKDAY');
    rows.push({ date: raw.date, weekday, isOff: raw.isOff, remark: raw.remark });
  }
  const start = Date.UTC(y, 0, 1);
  rows.forEach((row, index) => {
    if (row.date !== new Date(start + index * DAY_MS).toISOString().slice(0, 10)) throw codedError('NOT_CONTINUOUS');
  });
  const expectedDays = Math.round((Date.UTC(y + 1, 0, 1) - start) / DAY_MS);
  if (rows.length !== expectedDays) throw codedError('ROW_COUNT');
  return rows;
}

/** 解析政府 CSV：西元日期,星期,是否放假,備註（是否放假 0=上班、2=放假）。驗證失敗丟出對應代碼 */
export function parseCalendarCsv(text, year) {
  const lines = stripBom(text).split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) throw codedError('BAD_HEADER');
  const header = lines[0].split(',').map((cell) => stripBom(cell).trim());
  if (CSV_HEADER.some((name, index) => header[index] !== name)) throw codedError('BAD_HEADER');
  const rawRows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const value = String(cells[2] ?? '').trim();
    if (value !== '0' && value !== '2') throw codedError('BAD_VALUE');
    return {
      date: dateKeyFromCompact(cells[0]),
      weekdayChar: String(cells[1] ?? '').trim(),
      isOff: value === '2',
      remark: cells.slice(3).join(',').trim(),
    };
  });
  return validateYearRows(rawRows, year);
}

/** 解析 ruyut JSON：[{ date: 'YYYYMMDD', week: '一'..'日', isHoliday, description }] */
export function parseRuyutJson(text, year) {
  let data;
  try {
    data = JSON.parse(stripBom(text));
  } catch {
    throw codedError('BAD_JSON');
  }
  if (!Array.isArray(data)) throw codedError('BAD_JSON');
  const rawRows = data.map((item) => ({
    date: dateKeyFromCompact(item?.date),
    weekdayChar: String(item?.week ?? '').trim(),
    isOff: item?.isHoliday === true,
    remark: String(item?.description ?? '').trim(),
  }));
  return validateYearRows(rawRows, year);
}

async function loadRuyutCandidate(year, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const url = ruyutUrl(year);
  const buffer = await fetchPublicCalendarFile(url, { fetchImpl, timeoutMs });
  const rows = parseRuyutJson(new TextDecoder('utf-8').decode(buffer), year);
  return {
    source: 'ruyut',
    description: `${year} 年辦公日曆（ruyut/TaiwanCalendar 備援，commit ${RUYUT_PINNED_COMMIT.slice(0, 7)}）`,
    url,
    uploadFolder: '',
    sha256: sha256Of(buffer),
    encoding: 'json',
    rows,
    recommended: true,
    metadataModifiedDate: '',
  };
}

/** ruyut 備援的一年份每日資料（已驗證） */
export async function fetchRuyutYear(year, opts = {}) {
  const candidate = await loadRuyutCandidate(year, opts);
  return candidate.rows;
}

export function assertCalendarYearInRange(year, now = new Date()) {
  const y = Number(year);
  const max = currentTaipeiYear(now) + 1;
  if (!Number.isInteger(y) || y < MIN_CALENDAR_YEAR || y > max) {
    throw codedError('YEAR_OUT_OF_RANGE', 'YEAR_OUT_OF_RANGE', { status: 400 });
  }
  return y;
}

/**
 * 取得某年度的候選檔案（已下載、解碼、驗證）：
 *   source 'auto'（預設）= 政府資料；metadata 抓不到、該年度沒有檔案、或每份檔案都驗證失敗時改用 ruyut 備援。
 *   'dgpa' / 'ruyut' 指定只用該來源。
 * 同一份內容（sha256 相同）只留一份。全部失敗時丟出 INVALID_CSV（有驗證錯誤，detail 為代碼）或 SOURCE_UNAVAILABLE。
 */
export async function loadPublicCalendarCandidates(year, { source = 'auto', fetchImpl = fetch, now = new Date() } = {}) {
  const y = assertCalendarYearInRange(year, now);
  const failures = [];
  const candidates = [];

  if (source === 'auto' || source === 'dgpa') {
    try {
      const { metadataModifiedDate, resources } = await discoverDgpaResources({ fetchImpl });
      for (const resource of resources.filter((item) => item.year === y)) {
        try {
          const buffer = await fetchPublicCalendarFile(resource.url, { fetchImpl });
          const { text, encoding } = decodeCalendarCsv(buffer);
          const rows = parseCalendarCsv(text, y);
          candidates.push({
            source: 'dgpa',
            description: resource.description,
            url: resource.url,
            uploadFolder: resource.uploadFolder,
            sha256: sha256Of(buffer),
            encoding,
            rows,
            recommended: resource.recommended,
            metadataModifiedDate,
          });
        } catch (error) {
          failures.push(error?.code || 'FETCH_FAILED');
        }
      }
      if (!resources.some((item) => item.year === y)) failures.push('NO_RESOURCE');
    } catch (error) {
      failures.push(error?.code || 'FETCH_FAILED');
    }
  }

  if ((source === 'auto' && !candidates.length) || source === 'ruyut') {
    try {
      candidates.push(await loadRuyutCandidate(y, { fetchImpl }));
    } catch (error) {
      failures.push(error?.code || 'FETCH_FAILED');
    }
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.sha256)) continue;
    seen.add(candidate.sha256);
    unique.push(candidate);
  }
  if (!unique.length) {
    const validation = failures.find((code) => CALENDAR_VALIDATION_CODES.includes(code) && code !== 'ENCODING_UNSUPPORTED');
    if (validation) throw codedError('INVALID_CSV', 'INVALID_CSV', { detail: validation, status: 422, failures });
    throw codedError('SOURCE_UNAVAILABLE', 'SOURCE_UNAVAILABLE', { status: 502, failures });
  }
  const grouped = markRecommended(unique.map((candidate) => ({ ...candidate, year: y })));
  return grouped.map(({ year: _year, ...candidate }) => candidate);
}
