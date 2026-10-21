import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  RUYUT_PINNED_COMMIT,
  decodeCalendarCsv,
  discoverDgpaResources,
  loadPublicCalendarCandidates,
  parseCalendarCsv,
  ruyutUrl,
} from '../src/services/publicCalendarSource.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (...parts) => readFileSync(path.join(fixtures, ...parts));
const metadata = JSON.parse(read('dgpa', 'dataset-14718.json').toString('utf8'));
// 2026-10-21（台灣時間）：可取得的年度到 2027
const NOW = new Date('2026-10-21T04:00:00.000Z');

function okResponse(body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buffer.toString('utf8')),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

const FILE_BY_UUID = {
  'daec35f0-ae43-4466-aa26-bafb39aa8e0a': 'roc110.csv',
  'dd89fe8c-25f5-4035-a31e-7c14b44a74d7': 'roc112.csv',
  '22f9fcbc-fbb2-4387-8bcf-73b2279666c2': 'roc114.csv',
  'b84cb88a-803c-4621-a843-d637b2775615': 'roc114-1141020.csv',
  'a52331bd-a189-466b-b0f0-cae3062bbf74': 'roc115.csv',
  'f538b1ff-ba60-4c63-9477-10db8e6612d1': 'roc116.csv',
};

/** 模擬政府資料平台與 jsDelivr：metadata 用真實擷取的內容，下載的檔案用真實檔案 */
function fakeFetch({ metadataFails = false } = {}) {
  return jest.fn(async (url) => {
    const text = String(url);
    if (text.startsWith('https://data.gov.tw/api/v2/rest/dataset/14718')) {
      if (metadataFails) throw new TypeError('fetch failed');
      return okResponse(metadata);
    }
    const uuid = Object.keys(FILE_BY_UUID).find((key) => text.includes(key));
    if (uuid) return okResponse(read('dgpa', FILE_BY_UUID[uuid]));
    if (text === ruyutUrl(2026)) return okResponse(read('ruyut', '2026.json'));
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  });
}

function syntheticCsv(year, mutate = (rows) => rows) {
  const chars = ['日', '一', '二', '三', '四', '五', '六'];
  let rows = [];
  for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += 86400000) {
    const date = new Date(time);
    const weekday = date.getUTCDay();
    rows.push([date.toISOString().slice(0, 10).replace(/-/g, ''), chars[weekday], weekday === 0 || weekday === 6 ? '2' : '0', '']);
  }
  rows = mutate(rows);
  return ['西元日期,星期,是否放假,備註', ...rows.map((row) => row.join(','))].join('\r\n');
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('decodeCalendarCsv / parseCalendarCsv', () => {
  it('decodes the UTF-8 BOM file and returns 365 validated rows', () => {
    const { text, encoding } = decodeCalendarCsv(read('dgpa', 'roc115.csv'));
    const rows = parseCalendarCsv(text, 2026);

    expect(encoding).toBe('utf-8-bom');
    expect(rows).toHaveLength(365);
    expect(rows[0]).toEqual({ date: '2026-01-01', weekday: 4, isOff: true, remark: '開國紀念日' });
    expect(rows.find((row) => row.date === '2026-02-20')).toMatchObject({ isOff: true, remark: '補假' });
  });

  it('detects the Big5 file by its content, whatever the metadata says', () => {
    const { text, encoding } = decodeCalendarCsv(read('dgpa', 'roc114-1141020.csv'));
    const rows = parseCalendarCsv(text, 2025);

    expect(encoding).toBe('big5');
    expect(rows.find((row) => row.date === '2025-09-28')).toMatchObject({ remark: '孔子誕辰紀念日', isOff: true });
  });

  it('decodes plain UTF-8 without a BOM', () => {
    const { encoding } = decodeCalendarCsv(Buffer.from(syntheticCsv(2030), 'utf8'));
    expect(encoding).toBe('utf-8');
  });

  it('rejects malformed files with a specific validation code', () => {
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030, (rows) => rows.slice(0, 364)), 2030))).toBe('ROW_COUNT');
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030, (rows) => {
      rows[10][2] = '1';
      return rows;
    }), 2030))).toBe('BAD_VALUE');
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030, (rows) => [...rows.slice(0, 40), ...rows.slice(41)]), 2030))).toBe('NOT_CONTINUOUS');
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030).replace('西元日期', 'Date'), 2030))).toBe('BAD_HEADER');
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030, (rows) => {
      rows[3][1] = '日';
      return rows;
    }), 2030))).toBe('BAD_WEEKDAY');
    expect(codeOf(() => parseCalendarCsv(syntheticCsv(2030), 2031))).toBe('WRONG_YEAR');
  });

  it('raises ENCODING_UNSUPPORTED when the Big5 decoder is not available', () => {
    const RealDecoder = global.TextDecoder;
    jest.spyOn(global, 'TextDecoder').mockImplementation((label, options) => {
      if (String(label).toLowerCase() === 'big5') throw new RangeError('unsupported');
      return new RealDecoder(label, options);
    });

    expect(codeOf(() => decodeCalendarCsv(read('dgpa', 'roc114-1141020.csv')))).toBe('ENCODING_UNSUPPORTED');
  });
});

describe('discoverDgpaResources', () => {
  it('keeps only the day-by-day CSVs, one per ROC year, and recommends the 更新 file when 2025 has two', async () => {
    const fetchImpl = fakeFetch();
    const { metadataModifiedDate, resources } = await discoverDgpaResources({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('https://data.gov.tw/api/v2/rest/dataset/14718', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json', 'User-Agent': 'hr-system-holiday-sync' }),
    }));
    expect(metadataModifiedDate).toBe('2026-07-15 11:29:25');
    expect(resources).toHaveLength(12);
    expect(resources.some((resource) => resource.description.includes('Google'))).toBe(false);
    const y2025 = resources.filter((resource) => resource.year === 2025);
    expect(y2025).toHaveLength(2);
    expect(y2025.filter((resource) => resource.recommended).map((resource) => resource.description))
      .toEqual(['114年中華民國政府行政機關辦公日曆表(1141020更新)']);
    expect(resources.find((resource) => resource.year === 2026)).toMatchObject({ rocYear: 115, uploadFolder: '202506', recommended: true });
    // 113、114 年的網址含未編碼的中文，要經 new URL().href 轉成百分比編碼
    for (const resource of resources) {
      expect(resource.url).toBe(new URL(resource.url).href);
      expect(resource.url).not.toMatch(/[一-鿿]/);
    }
  });
});

describe('loadPublicCalendarCandidates', () => {
  it('returns one validated candidate for 2026 from the official source', async () => {
    const candidates = await loadPublicCalendarCandidates(2026, { fetchImpl: fakeFetch(), now: NOW });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: 'dgpa', encoding: 'utf-8-bom', recommended: true, uploadFolder: '202506' });
    expect(candidates[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(candidates[0].rows).toHaveLength(365);
  });

  it('returns both 2025 files as a conflict, with the revised one recommended', async () => {
    const candidates = await loadPublicCalendarCandidates(2025, { fetchImpl: fakeFetch(), now: NOW });

    expect(candidates).toHaveLength(2);
    expect(candidates.find((candidate) => candidate.recommended).description).toContain('1141020更新');
    expect(candidates.map((candidate) => candidate.encoding).sort()).toEqual(['big5', 'utf-8-bom']);
  });

  it('falls back to the pinned ruyut file when the official metadata cannot be fetched', async () => {
    const fetchImpl = fakeFetch({ metadataFails: true });
    const candidates = await loadPublicCalendarCandidates(2026, { fetchImpl, now: NOW });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: 'ruyut', encoding: 'json' });
    expect(candidates[0].url).toContain(`@${RUYUT_PINNED_COMMIT}`);
    expect(candidates[0].url).toContain('@73d814e768c94f2426af0787c96658d69068c3ff');
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => /TaiwanCalendar\/data\//.test(url))).toBe(false);
  });

  it('falls back to ruyut when the Big5 decoder is missing and every official file fails', async () => {
    const RealDecoder = global.TextDecoder;
    jest.spyOn(global, 'TextDecoder').mockImplementation((label, options) => {
      if (String(label).toLowerCase() === 'big5') throw new RangeError('unsupported');
      return new RealDecoder(label, options);
    });
    const fetchImpl = fakeFetch();
    // 2026 的官方檔案改成無法以 UTF-8 解碼的內容，只能用 Big5
    const broken = Buffer.from([0xa6, 0xe8, 0xa4, 0xb8]);
    fetchImpl.mockImplementation(async (url) => {
      const text = String(url);
      if (text.startsWith('https://data.gov.tw/')) return okResponse(metadata);
      if (text.includes('a52331bd')) return okResponse(broken);
      if (text === ruyutUrl(2026)) return okResponse(read('ruyut', '2026.json'));
      return { ok: false, status: 404 };
    });

    const candidates = await loadPublicCalendarCandidates(2026, { fetchImpl, now: NOW });
    expect(candidates.map((candidate) => candidate.source)).toEqual(['ruyut']);
  });

  it('always uses a commit-pinned ruyut URL', () => {
    expect(ruyutUrl(2027)).toBe(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar@${RUYUT_PINNED_COMMIT}/data/2027.json`);
    expect(ruyutUrl(2027)).toContain('@');
  });

  it('rejects years outside 2017..next year without touching the network', async () => {
    const fetchImpl = fakeFetch();
    await expect(loadPublicCalendarCandidates(2016, { fetchImpl, now: NOW })).rejects.toMatchObject({ code: 'YEAR_OUT_OF_RANGE' });
    await expect(loadPublicCalendarCandidates(2028, { fetchImpl, now: NOW })).rejects.toMatchObject({ code: 'YEAR_OUT_OF_RANGE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports SOURCE_UNAVAILABLE when neither source answers', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(loadPublicCalendarCandidates(2026, { fetchImpl, now: NOW })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });
});
