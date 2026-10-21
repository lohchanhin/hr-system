import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// 公司行事曆流程（政府資料 -> 草稿 -> 核定）的服務測試：模型換成記憶體內的替身（支援本服務用到的查詢與更新運算子、
// 唯一索引），網路換成回傳真實政府檔案的假 fetch。真實 MongoDB 上的端到端檢查另外執行。

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (...parts) => readFileSync(path.join(fixtures, ...parts));
const metadata = JSON.parse(read('dgpa', 'dataset-14718.json').toString('utf8'));
const NOW = new Date('2026-10-21T04:00:00.000Z');

// ------------------------------------------------------------------
// 記憶體內的模型替身
// ------------------------------------------------------------------
let idCounter = 0;
function newId() {
  idCounter += 1;
  return idCounter.toString(16).padStart(24, '0');
}

// structuredClone 產生的 Date 可能來自另一個 realm，不能用 instanceof 判斷
function isDate(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function comparable(value) {
  if (isDate(value)) return value.getTime();
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
  return value;
}

function getPath(doc, key) {
  return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), doc);
}

function setPath(doc, key, value) {
  const parts = key.split('.');
  let cursor = doc;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function unsetPath(doc, key) {
  const parts = key.split('.');
  let cursor = doc;
  for (const part of parts.slice(0, -1)) {
    if (cursor[part] == null) return;
    cursor = cursor[part];
  }
  delete cursor[parts[parts.length - 1]];
}

function equalValues(a, b) {
  return String(comparable(a)) === String(comparable(b)) && (a == null) === (b == null);
}

function matchCondition(value, condition) {
  if (condition && typeof condition === 'object' && !isDate(condition) && !Array.isArray(condition)
    && Object.keys(condition).some((key) => key.startsWith('$'))) {
    return Object.entries(condition).every(([operator, operand]) => {
      switch (operator) {
        case '$ne': return operand === null ? value != null : !(value !== undefined && equalValues(value, operand));
        case '$in': return operand.some((item) => value !== undefined && equalValues(value, item));
        case '$gte': return value != null && comparable(value) >= comparable(operand);
        case '$lt': return value != null && comparable(value) < comparable(operand);
        case '$exists': return operand ? value !== undefined : value === undefined;
        default: throw new Error(`unsupported operator ${operator}`);
      }
    });
  }
  if (condition === null) return value == null;
  if (Array.isArray(value)) return value.some((item) => equalValues(item, condition));
  return value !== undefined && equalValues(value, condition);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => matchCondition(getPath(doc, key), condition));
}

function clone(value) {
  return structuredClone(value);
}

function createFakeModel(name, { defaults = () => ({}), unique = [] } = {}) {
  let docs = [];
  const duplicateError = () => Object.assign(new Error(`E11000 duplicate key ${name}`), { code: 11000 });
  const assertUnique = (candidate) => {
    for (const index of unique) {
      if (index.partial && !index.partial(candidate)) continue;
      const clash = docs.find((doc) => doc !== candidate && doc._id !== candidate._id
        && (!index.partial || index.partial(doc))
        && index.fields.every((field) => equalValues(getPath(doc, field), getPath(candidate, field))));
      if (clash) throw duplicateError();
    }
  };
  const applyUpdate = (doc, update, inserting) => {
    for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, clone(value));
    if (inserting) for (const [key, value] of Object.entries(update.$setOnInsert || {})) setPath(doc, key, clone(value));
    for (const key of Object.keys(update.$unset || {})) unsetPath(doc, key);
    doc.updatedAt = new Date();
  };
  const query = (resolve) => {
    let sortSpec = null;
    let limitCount = null;
    const run = () => {
      let result = resolve();
      if (Array.isArray(result)) {
        if (sortSpec) {
          const [[field, direction]] = Object.entries(sortSpec);
          result = [...result].sort((a, b) => (comparable(getPath(a, field)) > comparable(getPath(b, field)) ? 1 : -1) * direction);
        }
        if (limitCount) result = result.slice(0, limitCount);
      }
      return clone(result);
    };
    const chain = {
      sort: (spec) => { sortSpec = spec; return chain; },
      select: () => chain,
      limit: (count) => { limitCount = count; return chain; },
      lean: () => chain,
      then: (onFulfilled, onRejected) => Promise.resolve().then(run).then(onFulfilled, onRejected),
    };
    return chain;
  };
  const insert = (data) => {
    const doc = { ...defaults(), ...clone(data), _id: data._id ?? newId(), createdAt: new Date(), updatedAt: new Date() };
    assertUnique(doc);
    docs.push(doc);
    return doc;
  };
  const upsertSeed = (filter) => Object.fromEntries(Object.entries(filter)
    .filter(([key, value]) => !key.startsWith('$') && !(value && typeof value === 'object' && !isDate(value)
      && Object.keys(value).some((k) => k.startsWith('$')))));
  const model = {
    find: jest.fn((filter = {}) => query(() => docs.filter((doc) => matches(doc, filter)))),
    findOne: jest.fn((filter = {}) => query(() => docs.find((doc) => matches(doc, filter)) ?? null)),
    findById: jest.fn((id) => query(() => docs.find((doc) => String(doc._id) === String(id)) ?? null)),
    exists: jest.fn((filter = {}) => query(() => {
      const doc = docs.find((item) => matches(item, filter));
      return doc ? { _id: doc._id } : null;
    })),
    countDocuments: jest.fn(async (filter = {}) => docs.filter((doc) => matches(doc, filter)).length),
    create: jest.fn(async (data) => {
      const doc = insert(data);
      return { ...clone(doc), toObject: () => clone(doc) };
    }),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      const doc = docs.find((item) => matches(item, filter));
      if (doc) {
        const before = clone(doc);
        applyUpdate(doc, update, false);
        try {
          assertUnique(doc);
        } catch (error) {
          Object.keys(doc).forEach((key) => delete doc[key]);
          Object.assign(doc, before);
          throw error;
        }
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const seed = { ...defaults(), ...clone(upsertSeed(filter)), _id: newId(), createdAt: new Date() };
      applyUpdate(seed, update, true);
      assertUnique(seed);
      docs.push(seed);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: seed._id };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const targets = docs.filter((doc) => matches(doc, filter));
      targets.forEach((doc) => applyUpdate(doc, update, false));
      return { acknowledged: true, matchedCount: targets.length, modifiedCount: targets.length };
    }),
    findOneAndUpdate: jest.fn((filter, update, options = {}) => query(() => {
      let doc = docs.find((item) => matches(item, filter));
      if (doc) {
        applyUpdate(doc, update, false);
        return doc;
      }
      if (!options.upsert) return null;
      doc = { ...defaults(), ...clone(upsertSeed(filter)), _id: newId(), createdAt: new Date() };
      applyUpdate(doc, update, true);
      assertUnique(doc);
      docs.push(doc);
      return doc;
    })),
    findByIdAndDelete: jest.fn(async (id) => {
      const index = docs.findIndex((doc) => String(doc._id) === String(id));
      return index >= 0 ? docs.splice(index, 1)[0] : null;
    }),
    createIndexes: jest.fn(async () => undefined),
    __docs: () => docs,
    __reset: (list = []) => { docs = list.map((item) => ({ ...defaults(), ...clone(item), _id: item._id ?? newId() })); },
  };
  return model;
}

const Holiday = createFakeModel('Holiday', {
  defaults: () => ({ origin: 'manual', hrEdited: false, archived: false, needsReview: false, reviewNote: '', excludedEmployees: [], note: '', compensatesDate: null, compensatesName: '', statutoryKey: '' }),
  unique: [{ fields: ['date', 'kind'], partial: (doc) => doc.archived === false }],
});
const CalendarYear = createFakeModel('CalendarYear', {
  defaults: () => ({ state: 'draft', migrated: false, followGovernmentAdjustments: false, pendingSnapshot: null }),
  unique: [{ fields: ['year'] }],
});
const PublicCalendarSnapshot = createFakeModel('PublicCalendarSnapshot', {
  defaults: () => ({ status: 'candidate', recommended: false, warnings: [] }),
  unique: [{ fields: ['year', 'source', 'sha256'] }],
});
const CalendarNotice = createFakeModel('CalendarNotice', { defaults: () => ({ status: 'open' }), unique: [{ fields: ['dedupeKey'] }] });
const CalendarSourceState = createFakeModel('CalendarSourceState', { defaults: () => ({ lastRunDay: '' }), unique: [{ fields: ['key'] }] });
const HolidayMoveSetting = createFakeModel('HolidayMoveSetting');
const HolidayRestResolution = createFakeModel('HolidayRestResolution');
const HolidayCompensation = createFakeModel('HolidayCompensation');
const HolidaySwap = createFakeModel('HolidaySwap');
const Employee = createFakeModel('Employee');
const ALL_MODELS = [Holiday, CalendarYear, PublicCalendarSnapshot, CalendarNotice, CalendarSourceState, HolidayMoveSetting, HolidayRestResolution, HolidayCompensation, HolidaySwap, Employee];

let service;

beforeAll(async () => {
  const mock = (file, model) => jest.unstable_mockModule(`../src/models/${file}.js`, () => ({ default: model }));
  await mock('Holiday', Holiday);
  await mock('CalendarYear', CalendarYear);
  await mock('PublicCalendarSnapshot', PublicCalendarSnapshot);
  await mock('CalendarNotice', CalendarNotice);
  await mock('CalendarSourceState', CalendarSourceState);
  await mock('HolidayMoveSetting', HolidayMoveSetting);
  await mock('HolidayRestResolution', HolidayRestResolution);
  await mock('HolidayCompensation', HolidayCompensation);
  await mock('HolidaySwap', HolidaySwap);
  await mock('Employee', Employee);
  service = await import('../src/services/companyCalendarService.js');
});

beforeEach(() => {
  ALL_MODELS.forEach((model) => model.__reset());
  jest.clearAllMocks();
});

// ------------------------------------------------------------------
// 假的政府資料平台
// ------------------------------------------------------------------
const FILE_BY_UUID = {
  '22f9fcbc-fbb2-4387-8bcf-73b2279666c2': 'roc114.csv',
  'b84cb88a-803c-4621-a843-d637b2775615': 'roc114-1141020.csv',
  'a52331bd-a189-466b-b0f0-cae3062bbf74': 'roc115.csv',
  'f538b1ff-ba60-4c63-9477-10db8e6612d1': 'roc116.csv',
};

function okResponse(buffer) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buffer.toString('utf8')),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

/** only = 只提供這些檔案（模擬 metadata 只列出部分檔案） */
function fakeFetch({ only = null } = {}) {
  return jest.fn(async (url) => {
    const text = String(url);
    if (text.startsWith('https://data.gov.tw/api/v2/rest/dataset/14718')) {
      const copy = structuredClone(metadata);
      if (only) {
        copy.result.distribution = copy.result.distribution.filter((item) => (
          !String(item.resourceField?.[0]?.name ?? '').includes('西元日期')
          || only.some((file) => item.resourceDownloadUrl.includes(Object.keys(FILE_BY_UUID).find((key) => FILE_BY_UUID[key] === file)))
        ));
      }
      return okResponse(Buffer.from(JSON.stringify(copy)));
    }
    const uuid = Object.keys(FILE_BY_UUID).find((key) => text.includes(key));
    if (uuid) return okResponse(read('dgpa', FILE_BY_UUID[uuid]));
    return { ok: false, status: 404 };
  });
}

const key = (value) => new Date(value).toISOString().slice(0, 10);
const activeRows = (year) => Holiday.__docs().filter((row) => !row.archived && key(row.date).startsWith(String(year)));

async function fetchAndApply(year, { only, decisions } = {}) {
  const fetched = await service.fetchYearCandidates({ year, fetchImpl: fakeFetch({ only }), now: NOW });
  const snapshotId = fetched.selected ?? fetched.candidates.find((candidate) => candidate.recommended)?.snapshotId;
  const applied = await service.applySnapshot({ year, snapshotId, decisions, actorId: 'admin-1' });
  return { fetched, applied, snapshotId };
}

describe('fetch and apply a government calendar', () => {
  it('creates 22 rows and a draft year on an empty 2026', async () => {
    const { fetched, applied } = await fetchAndApply(2026);

    expect(fetched.conflict).toBe(false);
    expect(fetched.diff.counts).toEqual({ add: 22, change: 0, remove: 0, conflict: 0 });
    expect(applied).toMatchObject({ year: 2026, applied: { added: 22, changed: 0, removed: 0, kept: 0 }, state: 'draft' });
    const rows = activeRows(2026);
    expect(rows).toHaveLength(22);
    expect(rows.filter((row) => row.kind === 'statutory')).toHaveLength(16);
    const makeup = rows.find((row) => key(row.date) === '2026-02-20');
    expect(makeup).toMatchObject({ kind: 'gov_makeup_off', type: '公務機關補假', origin: 'public', source: 'dgpa', linkMethod: 'rule', year: 2026 });
    expect(key(makeup.compensatesDate)).toBe('2026-02-15');
    expect(CalendarYear.__docs()).toEqual([expect.objectContaining({ year: 2026, state: 'draft', source: expect.objectContaining({ kind: 'dgpa' }) })]);
    expect(PublicCalendarSnapshot.__docs()[0].status).toBe('applied');
  });

  it('shows no difference when the identical file is fetched again, and keeps one snapshot', async () => {
    await fetchAndApply(2026);
    const again = await service.fetchYearCandidates({ year: 2026, fetchImpl: fakeFetch(), now: NOW });

    expect(again.diff.counts).toEqual({ add: 0, change: 0, remove: 0, conflict: 0 });
    expect(again.diff.unchanged).toBe(22);
    expect(PublicCalendarSnapshot.__docs()).toHaveLength(1);
  });

  it('2025: applying the original file, then the revised one adds 09-28, 09-29, 10-24, 10-25 and 12-25', async () => {
    const first = await service.fetchYearCandidates({ year: 2025, fetchImpl: fakeFetch({ only: ['roc114.csv'] }), now: NOW });
    expect(first.conflict).toBe(false);
    await service.applySnapshot({ year: 2025, snapshotId: first.selected });

    const revised = await service.fetchYearCandidates({ year: 2025, fetchImpl: fakeFetch({ only: ['roc114-1141020.csv'] }), now: NOW });
    expect(revised.diff.changes.filter((change) => change.type === 'add').map((change) => change.key))
      .toEqual(['2025-09-28', '2025-09-29', '2025-10-24', '2025-10-25', '2025-12-25']);
    expect(revised.diff.counts).toMatchObject({ add: 5, change: 0, remove: 0 });
  });

  it('2025 with both files published: a conflict with two candidates and no diff', async () => {
    const fetched = await service.fetchYearCandidates({ year: 2025, fetchImpl: fakeFetch(), now: NOW });

    expect(fetched.conflict).toBe(true);
    expect(fetched.candidates).toHaveLength(2);
    expect(fetched.selected).toBeNull();
    expect(fetched.diff).toBeNull();
    expect(fetched.candidates.find((candidate) => candidate.recommended).resourceDescription).toContain('1141020更新');
  });

  it('marks rows that HR changed as conflicts that keep the current value by default', async () => {
    await fetchAndApply(2026);
    const row = activeRows(2026).find((item) => key(item.date) === '2026-02-27');
    await Holiday.updateOne({ _id: row._id }, { $set: { kind: 'company_off', name: '公司休息日', hrEdited: true } });

    const fetched = await service.fetchYearCandidates({ year: 2026, fetchImpl: fakeFetch(), now: NOW });
    const change = fetched.diff.changes.find((item) => item.key === '2026-02-27');
    expect(change).toMatchObject({ type: 'change', conflict: true, defaultDecision: 'keep', fields: expect.arrayContaining(['kind', 'name']) });

    // 預設保留 -> 不變
    await service.applySnapshot({ year: 2026, snapshotId: fetched.selected });
    expect(Holiday.__docs().find((item) => item._id === row._id)).toMatchObject({ kind: 'company_off', hrEdited: true });

    // 明確採用政府資料 -> 改回，hrEdited 清掉
    const result = await service.applySnapshot({ year: 2026, snapshotId: fetched.selected, decisions: { '2026-02-27': 'accept' } });
    expect(result.applied.changed).toBe(1);
    expect(Holiday.__docs().find((item) => item._id === row._id)).toMatchObject({ kind: 'gov_makeup_off', hrEdited: false });
  });

  it('keeps an HR delete as a tombstone; the re-import proposes an add with a conflict that defaults to keep', async () => {
    await fetchAndApply(2026);
    const row = activeRows(2026).find((item) => key(item.date) === '2026-10-26');
    await Holiday.updateOne({ _id: row._id }, { $set: { archived: true, hrEdited: true } });

    const fetched = await service.fetchYearCandidates({ year: 2026, fetchImpl: fakeFetch(), now: NOW });
    const change = fetched.diff.changes.find((item) => item.key === '2026-10-26');
    expect(change).toMatchObject({ type: 'add', conflict: true, defaultDecision: 'keep', current: expect.objectContaining({ archived: true }) });

    await service.applySnapshot({ year: 2026, snapshotId: fetched.selected });
    expect(activeRows(2026).some((item) => key(item.date) === '2026-10-26')).toBe(false);

    await service.applySnapshot({ year: 2026, snapshotId: fetched.selected, decisions: { '2026-10-26': 'accept' } });
    expect(Holiday.__docs().filter((item) => key(item.date) === '2026-10-26')).toEqual([
      expect.objectContaining({ archived: false, hrEdited: false, kind: 'gov_makeup_off' }),
    ]);
  });

  it('never proposes to change or remove rows HR created by hand', async () => {
    Holiday.__reset([
      { date: new Date('2026-11-28T00:00:00.000Z'), kind: 'designated', name: '地方公職人員選舉', origin: 'manual', source: 'manual', archived: false },
      { date: new Date('2026-06-19T00:00:00.000Z'), kind: 'statutory', name: '端午節', origin: 'manual', source: 'manual', archived: false },
    ]);
    const fetched = await service.fetchYearCandidates({ year: 2026, fetchImpl: fakeFetch(), now: NOW });

    expect(fetched.diff.changes.some((change) => change.key === '2026-11-28')).toBe(false);
    expect(fetched.diff.changes.some((change) => change.key === '2026-06-19')).toBe(false);
    expect(fetched.diff.counts.add).toBe(21);
  });

  // 「保留目前」用在新增的日子（那天沒有資料）：要留下紀錄，否則下一份政府資料又預設加回
  it('remembers a declined add as an HR tombstone, so the next diff flags it as a conflict that defaults to keep', async () => {
    const fetched = await service.fetchYearCandidates({ year: 2027, fetchImpl: fakeFetch({ only: ['roc116.csv'] }), now: NOW });
    const applied = await service.applySnapshot({ year: 2027, snapshotId: fetched.selected, decisions: { '2027-10-11': 'keep' } });

    expect(applied.applied).toMatchObject({ added: 23, kept: 1 });
    expect(activeRows(2027).some((row) => key(row.date) === '2027-10-11')).toBe(false);
    expect(Holiday.__docs().filter((row) => key(row.date) === '2027-10-11')).toEqual([
      expect.objectContaining({ kind: 'gov_makeup_off', archived: true, hrEdited: true, origin: 'public', year: 2027 }),
    ]);

    const again = await service.fetchYearCandidates({ year: 2027, fetchImpl: fakeFetch({ only: ['roc116.csv'] }), now: NOW });
    expect(again.diff.changes).toEqual([
      expect.objectContaining({ key: '2027-10-11', type: 'add', conflict: true, defaultDecision: 'keep' }),
    ]);
    await service.applySnapshot({ year: 2027, snapshotId: again.selected });
    expect(activeRows(2027).some((row) => key(row.date) === '2027-10-11')).toBe(false);
    expect(Holiday.__docs().filter((row) => key(row.date) === '2027-10-11')).toHaveLength(1);
  });

  // 人資把 2027-10-11 的公務機關補假改到 10-12（holidayController 會在原日期留下已刪除紀錄）：
  // 預設套用時不能把 10-11 加回來，否則行政人員同一個國慶日有兩天補假
  it('does not re-add the original date of a row HR moved to another day', async () => {
    await fetchAndApply(2027, { only: ['roc116.csv'] });
    const row = activeRows(2027).find((item) => key(item.date) === '2027-10-11');
    await Holiday.updateOne({ _id: row._id }, { $set: { date: new Date('2027-10-12T00:00:00.000Z'), hrEdited: true } });
    await Holiday.create({
      date: new Date('2027-10-11T00:00:00.000Z'), kind: 'gov_makeup_off', name: '補假', origin: 'public', archived: true, hrEdited: true,
    });

    const fetched = await service.fetchYearCandidates({ year: 2027, fetchImpl: fakeFetch({ only: ['roc116.csv'] }), now: NOW });
    expect(fetched.diff.changes.map((change) => [change.key, change.type, change.conflict, change.defaultDecision])).toEqual([
      ['2027-10-11', 'add', true, 'keep'],
      ['2027-10-12', 'remove', true, 'keep'],
    ]);

    await service.applySnapshot({ year: 2027, snapshotId: fetched.selected });
    const makeupForNationalDay = activeRows(2027).filter((item) => item.kind === 'gov_makeup_off' && key(item.compensatesDate) === '2027-10-10');
    expect(makeupForNationalDay.map((item) => key(item.date))).toEqual(['2027-10-12']);
  });
});

describe('approval lifecycle', () => {
  it('blocks approval while rows need review unless acknowledged, then approves and resolves notices', async () => {
    await fetchAndApply(2026);
    const row = activeRows(2026)[0];
    await Holiday.updateOne({ _id: row._id }, { $set: { needsReview: true } });
    await CalendarNotice.create({ type: 'migrated_review', year: 2026, dedupeKey: 'migrated:2026', status: 'open' });

    await expect(service.approveYear({ year: 2026, actorId: 'admin-1' })).rejects.toMatchObject({ code: 'NEEDS_REVIEW_ROWS', status: 409, count: 1 });
    const approved = await service.approveYear({ year: 2026, acknowledgeWarnings: true, note: '人資已確認', actorId: 'admin-1' });

    expect(approved.state).toBe('approved');
    expect(CalendarYear.__docs()[0]).toMatchObject({ state: 'approved', migrated: false, approvalNote: '人資已確認', approvedBy: 'admin-1' });
    expect(CalendarYear.__docs()[0].approvedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(CalendarNotice.__docs()[0].status).toBe('resolved');
  });

  it('refuses to approve a year without any rows', async () => {
    await expect(service.approveYear({ year: 2027 })).rejects.toMatchObject({ code: 'NO_ROWS' });
  });

  it('sends an approved year back to draft when HR edits it, and on reopen', async () => {
    await fetchAndApply(2026);
    await service.approveYear({ year: 2026 });
    await service.markCalendarYearEdited(2026, 'admin-2');
    expect(CalendarYear.__docs()[0]).toMatchObject({ state: 'draft', updatedBy: 'admin-2' });
    expect(Number.isNaN(new Date(CalendarYear.__docs()[0].previousApprovedAt).getTime())).toBe(false);
    expect(CalendarYear.__docs()[0].previousApprovedAt).not.toBeNull();

    await service.approveYear({ year: 2026 });
    await service.reopenYear({ year: 2026 });
    expect(CalendarYear.__docs()[0].state).toBe('draft');
  });

  it('creates a draft year document when HR adds the first day of a year', async () => {
    await service.markCalendarYearEdited(2028, 'admin-1');
    expect(CalendarYear.__docs()).toEqual([expect.objectContaining({ year: 2028, state: 'draft', source: { kind: 'manual' } })]);
    await service.markCalendarYearEdited(1999, 'admin-1');
    expect(CalendarYear.__docs()).toHaveLength(1);
  });

  it('requires an agreement reference and date to follow government adjustments', async () => {
    await expect(service.updateYearSettings({ year: 2026, followGovernmentAdjustments: true, adjustmentAgreement: { reference: '' } }))
      .rejects.toMatchObject({ code: 'AGREEMENT_REQUIRED', status: 400 });
    expect(CalendarYear.__docs()).toHaveLength(0);

    await fetchAndApply(2026);
    await service.approveYear({ year: 2026 });
    const saved = await service.updateYearSettings({
      year: 2026,
      followGovernmentAdjustments: true,
      adjustmentAgreement: { reference: '勞資會議 115-3', date: '2026-01-15', note: '行政人員適用' },
    });
    expect(saved).toMatchObject({ state: 'draft', followGovernmentAdjustments: true, adjustmentAgreement: { reference: '勞資會議 115-3', date: '2026-01-15' } });
    expect(CalendarYear.__docs()[0]).toMatchObject({ state: 'draft', followGovernmentAdjustments: true });
  });

  it('computes the last approved date from consecutive approved years', () => {
    expect(service.lastApprovedDateOf([{ year: 2026, state: 'approved' }, { year: 2027, state: 'approved' }], NOW)).toBe('2027-12-31');
    expect(service.lastApprovedDateOf([{ year: 2026, state: 'approved' }, { year: 2027, state: 'draft' }], NOW)).toBe('2026-12-31');
    expect(service.lastApprovedDateOf([{ year: 2027, state: 'approved' }], NOW)).toBeNull();
  });
});

describe('the import/roc compatibility alias', () => {
  it('applies the single candidate as a draft on an empty year', async () => {
    const result = await service.importYearCompat({ year: 2026, fetchImpl: fakeFetch(), now: NOW });
    expect(result).toEqual({ applied: true, year: 2026, imported: 22, state: 'draft' });
  });

  it('writes no rows on a year that already has rows', async () => {
    Holiday.__reset([{ date: new Date('2026-01-01T00:00:00.000Z'), kind: 'statutory', name: '開國紀念日', origin: 'manual', archived: false }]);
    const result = await service.importYearCompat({ year: 2026, fetchImpl: fakeFetch(), now: NOW });

    expect(result.applied).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(Holiday.__docs()).toHaveLength(1);
  });
});

describe('daily check and notices', () => {
  it('runs the source check once when two daily ticks race, and still runs the daily tasks', async () => {
    const task = jest.fn(async () => {});
    const fetchImpl = fakeFetch({ only: ['roc116.csv'] });
    const [first, second] = await Promise.all([
      service.runDailyHolidayMaintenance({ dailyTasks: [task], now: NOW, fetchImpl }),
      service.runDailyHolidayMaintenance({ dailyTasks: [task], now: NOW, fetchImpl }),
    ]);

    expect([first.ran, second.ran].sort()).toEqual([false, true]);
    expect(task).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('dataset/14718'))).toHaveLength(1);
    const again = await service.runDailyHolidayMaintenance({ dailyTasks: [task], now: NOW, fetchImpl });
    expect(again.ran).toBe(false);
  });

  it('skips the source check before May but still runs the daily tasks', async () => {
    const task = jest.fn(async () => {});
    const fetchImpl = fakeFetch();
    const result = await service.runDailyHolidayMaintenance({ dailyTasks: [task], now: new Date('2026-04-10T04:00:00.000Z'), fetchImpl });

    expect(result).toMatchObject({ ran: true, check: null, tasks: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('a failing daily task does not stop the others', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken = jest.fn(async () => { throw new TypeError('boom'); });
    const after = jest.fn(async () => {});
    const result = await service.runDailyHolidayMaintenance({ dailyTasks: [broken, after], now: new Date('2026-03-02T04:00:00.000Z') });

    expect(result.tasks).toBe(1);
    expect(after).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Holiday calendar daily task failed', 'TypeError');
    errorSpy.mockRestore();
  });

  it('raises a new-year notice once per file, and a revision notice for a changed file of a year that has rows', async () => {
    const fetchImpl = fakeFetch({ only: ['roc115.csv', 'roc116.csv', 'roc114-1141020.csv'] });
    // 2026 已套用並核定；2027 還沒有行事曆；2025 由舊資料轉換（沒有來源 sha）
    await fetchAndApply(2026);
    await service.approveYear({ year: 2026 });
    Holiday.__docs().push({ _id: newId(), date: new Date('2025-01-01T00:00:00.000Z'), kind: 'statutory', name: '開國紀念日', origin: 'migrated', archived: false });
    await CalendarYear.updateOne({ year: 2025 }, { $setOnInsert: { state: 'draft', migrated: true, 'source.kind': 'migrated' } }, { upsert: true });

    const first = await service.checkPublicCalendarUpdates({ fetchImpl, now: NOW });
    expect(first.errors).toEqual([]);
    expect(first.notices.map((notice) => `${notice.type}:${notice.year}`).sort()).toEqual(['new_year_available:2027', 'revision_available:2025']);
    expect(CalendarYear.__docs().find((doc) => doc.year === 2025).pendingSnapshot).toBeTruthy();
    expect(CalendarSourceState.__docs()[0]).toMatchObject({ key: 'dgpa-14718', lastError: '', metadataModifiedDate: '2026-07-15 11:29:25' });

    const second = await service.checkPublicCalendarUpdates({ fetchImpl, now: NOW });
    expect(second.notices).toEqual([]);
    expect(CalendarNotice.__docs()).toHaveLength(2);
  });

  it('does not announce a new version when the file matches the current calendar exactly', async () => {
    // 2026 的資料內容和政府檔案相同，但沒有來源 sha（例如舊資料轉換後、還沒套用過政府資料）
    await fetchAndApply(2026);
    await CalendarYear.updateOne({ year: 2026 }, { $set: { 'source.sha256': '', 'source.kind': 'migrated' } });
    PublicCalendarSnapshot.__reset();

    const result = await service.checkPublicCalendarUpdates({ years: [2026], fetchImpl: fakeFetch({ only: ['roc115.csv'] }), now: NOW });

    expect(result.notices).toEqual([]);
    expect(CalendarYear.__docs()[0].pendingSnapshot).toBeNull();
  });

  // 政府重新產生、重新上傳的檔案：位元組不同（sha256 不同）但內容相同。差異只剩人資自己的修改時不能提醒「有新版本」
  it('does not announce a re-uploaded file with the same content when the only differences are HR edits', async () => {
    await fetchAndApply(2027, { only: ['roc116.csv'] });
    const row = activeRows(2027).find((item) => key(item.date) === '2027-03-01');
    await Holiday.updateOne({ _id: row._id }, { $set: { kind: 'company_off', name: '公司休息日', hrEdited: true } });
    const base = fakeFetch({ only: ['roc116.csv'] });
    const reuploaded = jest.fn(async (url) => (String(url).includes('f538b1ff-ba60-4c63-9477-10db8e6612d1')
      ? okResponse(Buffer.concat([read('dgpa', 'roc116.csv'), Buffer.from('\r\n')]))
      : base(url)));

    const result = await service.checkPublicCalendarUpdates({ years: [2027], fetchImpl: reuploaded, now: NOW });

    expect(PublicCalendarSnapshot.__docs()).toHaveLength(2);
    expect(result.notices).toEqual([]);
    expect(CalendarYear.__docs().find((doc) => doc.year === 2027).pendingSnapshot).toBeNull();
  });

  it('does not announce a version whose differences are only HR conflicts when no government file was applied yet', async () => {
    // 2026 由舊資料轉換（沒有套用過的政府資料）；人資刪除了 10-26 的公務機關補假
    await fetchAndApply(2026);
    await CalendarYear.updateOne({ year: 2026 }, { $set: { 'source.sha256': '', 'source.kind': 'migrated', 'source.snapshot': null } });
    PublicCalendarSnapshot.__reset();
    const row = activeRows(2026).find((item) => key(item.date) === '2026-10-26');
    await Holiday.updateOne({ _id: row._id }, { $set: { archived: true, hrEdited: true } });

    const result = await service.checkPublicCalendarUpdates({ years: [2026], fetchImpl: fakeFetch({ only: ['roc115.csv'] }), now: NOW });

    expect(result.notices).toEqual([]);
  });

  it('still announces a real revision even when it only touches dates HR already decided', async () => {
    // 2025 套用原始版後，人資曾在差異中拒絕這 5 天（已刪除紀錄）；修正版正好是這 5 天
    const first = await service.fetchYearCandidates({ year: 2025, fetchImpl: fakeFetch({ only: ['roc114.csv'] }), now: NOW });
    await service.applySnapshot({ year: 2025, snapshotId: first.selected });
    for (const date of ['2025-09-28', '2025-09-29', '2025-10-24', '2025-10-25', '2025-12-25']) {
      await Holiday.create({ date: new Date(`${date}T00:00:00.000Z`), kind: 'company_workday', name: '上班', origin: 'public', archived: true, hrEdited: true });
    }

    const result = await service.checkPublicCalendarUpdates({ years: [2025], fetchImpl: fakeFetch({ only: ['roc114-1141020.csv'] }), now: NOW });

    expect(result.notices.map((notice) => notice.type)).toEqual(['revision_available']);
  });

  it('raises a multiple-resources notice when a year has two files, and resolves notices when one is applied', async () => {
    const fetchImpl = fakeFetch();
    const result = await service.checkPublicCalendarUpdates({ years: [2025], fetchImpl, now: NOW });
    expect(result.notices.map((notice) => notice.type).sort()).toEqual(['multiple_resources', 'new_year_available']);

    const recommended = PublicCalendarSnapshot.__docs().find((snapshot) => snapshot.recommended);
    await service.applySnapshot({ year: 2025, snapshotId: recommended._id });
    expect(CalendarNotice.__docs().every((notice) => notice.status === 'resolved')).toBe(true);
    expect(PublicCalendarSnapshot.__docs().find((snapshot) => !snapshot.recommended).status).toBe('superseded');

    // 舊版檔案還掛在平台上：不再提醒「有新版本」
    const later = await service.checkPublicCalendarUpdates({ years: [2025], fetchImpl, now: NOW });
    expect(later.notices).toEqual([]);
  });

  it('records a short error code when the platform cannot be reached', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await service.checkPublicCalendarUpdates({ fetchImpl, now: NOW });

    expect(result.errors).toEqual(['FETCH_FAILED']);
    expect(CalendarSourceState.__docs()[0]).toMatchObject({ lastError: 'FETCH_FAILED' });
    expect(CalendarSourceState.__docs()[0].lastSuccessAt).toBeUndefined();
  });

  it('reminds admins from December when next year is not approved', async () => {
    const fetchImpl = jest.fn(async () => { throw new TypeError('offline'); });
    const result = await service.checkPublicCalendarUpdates({ fetchImpl, now: new Date('2026-12-02T04:00:00.000Z') });
    expect(result.notices).toEqual([expect.objectContaining({ type: 'year_not_approved', year: 2027 })]);
  });

  it('rejecting a snapshot resolves its notices and the same file is not announced again', async () => {
    const fetchImpl = fakeFetch({ only: ['roc116.csv'] });
    await service.checkPublicCalendarUpdates({ years: [2027], fetchImpl, now: NOW });
    const snapshot = PublicCalendarSnapshot.__docs()[0];

    await service.rejectSnapshot({ year: 2027, snapshotId: snapshot._id });
    expect(PublicCalendarSnapshot.__docs()[0].status).toBe('rejected');
    expect(CalendarNotice.__docs()[0].status).toBe('resolved');
    const again = await service.checkPublicCalendarUpdates({ years: [2027], fetchImpl, now: NOW });
    expect(again.notices).toEqual([]);
  });

  it('lists years with counts, notices and the last check', async () => {
    await fetchAndApply(2026);
    const overview = await service.listCalendarYears({ now: NOW });
    const y2026 = overview.years.find((item) => item.year === 2026);

    expect(overview.years.map((item) => item.year)).toEqual(expect.arrayContaining([2025, 2026, 2027]));
    expect(y2026).toMatchObject({ state: 'draft', counts: expect.objectContaining({ statutory: 16, gov_makeup_off: 6 }), needsReview: 0, unlinkedMakeup: 0 });
    expect(overview.years.find((item) => item.year === 2027).state).toBe('none');
    expect(overview.lastApprovedDate).toBeNull();

    const detail = await service.getCalendarYearDetail(2026, { now: NOW });
    expect(detail.days).toHaveLength(22);
    expect(detail.links).toContainEqual({ date: '2026-02-27', compensatesDate: '2026-02-28' });
    expect(detail.days.find((day) => day.date === '2026-02-27')).toMatchObject({ displayKind: 'gov_info', label: '公務機關補假' });
  });
});

describe('reconciliation report', () => {
  it('lists resolutions, moves, compensations and swaps on dates that are no longer statutory', async () => {
    await fetchAndApply(2026);
    const employeeId = newId();
    Employee.__reset([{ _id: employeeId, name: '王小美', employeeId: 'N001' }]);
    HolidayRestResolution.__reset([
      { employee: employeeId, holidayDate: new Date('2026-02-20T00:00:00.000Z'), holidayName: '補假', kind: 'paid' },
      { employee: employeeId, holidayDate: new Date('2026-02-28T00:00:00.000Z'), holidayName: '和平紀念日', kind: 'paid' },
    ]);
    HolidayMoveSetting.__reset([{ enableHolidayMove: true, sourceDate: new Date('2026-02-20T00:00:00.000Z'), targetDate: new Date('2026-02-28T00:00:00.000Z'), agreementReference: '', agreementDate: null }]);
    HolidayCompensation.__reset([{ employee: employeeId, holidayDate: new Date('2026-04-03T00:00:00.000Z'), status: 'open' }]);
    HolidaySwap.__reset([{ employee: employeeId, originalDate: new Date('2026-10-09T00:00:00.000Z'), targetDate: new Date('2026-10-10T00:00:00.000Z'), status: 'active' }]);

    const report = await service.buildCalendarReconciliation();

    expect(report.resolutions).toEqual([expect.objectContaining({ holidayDate: '2026-02-20', currentKind: 'gov_makeup_off', employeeNo: 'N001', name: '王小美' })]);
    expect(report.moves.map((item) => item.problem).sort()).toEqual(['missing_agreement', 'source_not_statutory', 'target_is_holiday']);
    expect(report.compensations).toEqual([expect.objectContaining({ holidayDate: '2026-04-03', problem: 'holiday_not_statutory' })]);
    expect(report.swaps.map((item) => item.problem).sort()).toEqual(['original_not_statutory', 'target_is_holiday']);
    expect(report.counts).toEqual({ resolutions: 1, moves: 3, compensations: 1, swaps: 2 });
  });

  // 公司調移的目標日撞到其他假日：同一天兩個假，員工會少放一天
  it('lists company moves whose target collides with another move, a personal swap, an assigned 補假 or a government make-up day', async () => {
    await fetchAndApply(2026);
    const employeeId = newId();
    const day = (date) => new Date(`${date}T00:00:00.000Z`);
    const agreed = { enableHolidayMove: true, agreementReference: '勞資會議 115-2', agreementDate: day('2026-01-10') };
    HolidayMoveSetting.__reset([
      { _id: 'move-a', ...agreed, sourceDate: day('2026-02-28'), targetDate: day('2026-03-02') },
      { _id: 'move-c', ...agreed, sourceDate: day('2026-06-19'), targetDate: day('2026-03-02') },
      { _id: 'move-b', ...agreed, sourceDate: day('2026-10-25'), targetDate: day('2026-12-14') },
      { _id: 'move-d', ...agreed, sourceDate: day('2026-09-25'), targetDate: day('2026-04-03') },
    ]);
    HolidaySwap.__reset([{ employee: employeeId, originalDate: day('2026-01-01'), targetDate: day('2026-03-02'), status: 'active' }]);
    HolidayCompensation.__reset([{ employee: employeeId, holidayDate: day('2026-10-10'), status: 'assigned', assignedDate: day('2026-12-14') }]);

    const report = await service.buildCalendarReconciliation();

    const problems = report.moves.map((item) => `${item.id}:${item.problem}`).sort();
    expect(problems).toEqual([
      'move-a:duplicate_target',
      'move-a:target_taken',
      'move-b:target_taken',
      'move-c:duplicate_target',
      'move-c:target_taken',
      'move-d:target_is_holiday',
    ]);
    expect(report.counts.moves).toBe(6);
  });
});
