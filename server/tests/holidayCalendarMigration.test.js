import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// 啟動時的行事曆資料轉換：模型換成記憶體內的替身（和 companyCalendarService.test.js 相同的替身，支援唯一索引），
// 模擬客戶正式環境可能有的舊資料（舊版一鍵載入的 2026、2025 年、手動資料、重複資料、國定假日休假紀錄）。

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
  defaults: () => ({ type: '國定假日' }),
  unique: [{ fields: ['date', 'kind'], partial: (doc) => doc.archived === false }],
});
const CalendarYear = createFakeModel('CalendarYear', { defaults: () => ({ state: 'draft', migrated: false }), unique: [{ fields: ['year'] }] });
const CalendarNotice = createFakeModel('CalendarNotice', { defaults: () => ({ status: 'open' }), unique: [{ fields: ['dedupeKey'] }] });
const HolidayMoveSetting = createFakeModel('HolidayMoveSetting');
const HolidayRestResolution = createFakeModel('HolidayRestResolution');
const PublicCalendarSnapshot = createFakeModel('PublicCalendarSnapshot');
const CalendarSourceState = createFakeModel('CalendarSourceState');
const HolidayCompensation = createFakeModel('HolidayCompensation');
const HolidaySwap = createFakeModel('HolidaySwap');
const ALL_MODELS = [Holiday, CalendarYear, CalendarNotice, HolidayMoveSetting, HolidayRestResolution, PublicCalendarSnapshot, CalendarSourceState, HolidayCompensation, HolidaySwap];

let migrateHolidayCalendarKinds;
let ensureHolidayCalendarIndexes;
let countOrphanHolidayResolutions;

beforeAll(async () => {
  const mock = (file, model) => jest.unstable_mockModule(`../src/models/${file}.js`, () => ({ default: model }));
  await mock('Holiday', Holiday);
  await mock('CalendarYear', CalendarYear);
  await mock('CalendarNotice', CalendarNotice);
  await mock('HolidayMoveSetting', HolidayMoveSetting);
  await mock('HolidayRestResolution', HolidayRestResolution);
  await mock('PublicCalendarSnapshot', PublicCalendarSnapshot);
  await mock('CalendarSourceState', CalendarSourceState);
  await mock('HolidayCompensation', HolidayCompensation);
  await mock('HolidaySwap', HolidaySwap);
  ({ migrateHolidayCalendarKinds, ensureHolidayCalendarIndexes, countOrphanHolidayResolutions } = await import('../src/services/holidayCalendarMigration.js'));
});

beforeEach(() => {
  ALL_MODELS.forEach((model) => model.__reset());
  jest.clearAllMocks();
});

const day = (key) => new Date(`${key}T00:00:00.000Z`);
const keyOf = (value) => new Date(value).toISOString().slice(0, 10);

// 舊版一鍵載入 2026 年的 22 筆（政府資料中有說明的放假日，一律存成「國定假日」）
const LEGACY_2026 = [
  ['2026-01-01', '開國紀念日'], ['2026-02-15', '小年夜'], ['2026-02-16', '農曆除夕'], ['2026-02-17', '春節'],
  ['2026-02-18', '春節'], ['2026-02-19', '春節'], ['2026-02-20', '補假'], ['2026-02-27', '補假'],
  ['2026-02-28', '和平紀念日'], ['2026-04-03', '補假'], ['2026-04-04', '兒童節'], ['2026-04-05', '清明節'],
  ['2026-04-06', '補假'], ['2026-05-01', '勞動節'], ['2026-06-19', '端午節'], ['2026-09-25', '中秋節'],
  ['2026-09-28', '孔子誕辰紀念日/教師節'], ['2026-10-09', '補假'], ['2026-10-10', '國慶日'],
  ['2026-10-25', '臺灣光復暨金門古寧頭大捷紀念日'], ['2026-10-26', '補假'], ['2026-12-25', '行憲紀念日'],
];
// 舊版一鍵載入 2025 年（原始版，13 筆；補行上班的 2/8 被丟掉，勞動節政府資料沒有）
const LEGACY_2025 = [
  ['2025-01-01', '開國紀念日'], ['2025-01-27', '小年夜'], ['2025-01-28', '農曆除夕'], ['2025-01-29', '春節'],
  ['2025-01-30', '春節'], ['2025-01-31', '春節'], ['2025-02-28', '和平紀念日'], ['2025-04-03', '補假'],
  ['2025-04-04', '兒童節及民族掃墓節'], ['2025-05-30', '補假'], ['2025-05-31', '端午節'], ['2025-10-06', '中秋節'],
  ['2025-10-10', '國慶日'],
];

function legacyImport(rows) {
  return rows.map(([date, name]) => ({ date: day(date), name, description: name, desc: name, type: '國定假日', source: 'roc-calendar' }));
}

const rowOn = (date, extra = {}) => Holiday.__docs().find((row) => keyOf(row.date) === date && Object.entries(extra).every(([k, v]) => row[k] === v));

describe('migrateHolidayCalendarKinds', () => {
  it('turns the legacy 2026 import into 16 statutory days and 6 linked government make-up days', async () => {
    Holiday.__reset(legacyImport(LEGACY_2026));

    const result = await migrateHolidayCalendarKinds();

    expect(result).toMatchObject({ rows: 22, years: 1, statutory: 16, govMakeupOff: 6, govBridgeOff: 0, added: 0, duplicates: 0, needsReview: 0 });
    const links = Object.fromEntries(Holiday.__docs()
      .filter((row) => row.kind === 'gov_makeup_off')
      .map((row) => [keyOf(row.date), keyOf(row.compensatesDate)]));
    expect(links).toEqual({
      '2026-02-20': '2026-02-15',
      '2026-02-27': '2026-02-28',
      '2026-04-03': '2026-04-04',
      '2026-04-06': '2026-04-05',
      '2026-10-09': '2026-10-10',
      '2026-10-26': '2026-10-25',
    });
    for (const row of Holiday.__docs()) {
      expect(row).toMatchObject({ year: 2026, origin: 'migrated', hrEdited: false, archived: false, type: '國定假日' });
    }
    expect(rowOn('2026-02-27')).toMatchObject({ compensatesName: '和平紀念日', linkMethod: 'rule', name: '補假' });
    expect(rowOn('2026-02-15')).toMatchObject({ kind: 'statutory', statutoryKey: 'lunar_eve_eve' });
  });

  it('turns the legacy 2025 import into the right kinds and adds 勞動節 by rule', async () => {
    Holiday.__reset(legacyImport(LEGACY_2025));

    const result = await migrateHolidayCalendarKinds();

    expect(rowOn('2025-01-27')).toMatchObject({ kind: 'gov_bridge_off' });
    expect(rowOn('2025-04-03')).toMatchObject({ kind: 'statutory', statutoryKey: 'children', name: '補假' });
    expect(rowOn('2025-04-04')).toMatchObject({ kind: 'statutory', statutoryKey: 'tomb_sweeping' });
    expect(rowOn('2025-05-30')).toMatchObject({ kind: 'gov_makeup_off' });
    expect(keyOf(rowOn('2025-05-30').compensatesDate)).toBe('2025-05-31');
    expect(rowOn('2025-05-01')).toMatchObject({ kind: 'statutory', name: '勞動節', origin: 'rule', source: 'statutory-rule', statutoryKey: 'labor', year: 2025, archived: false });
    expect(result).toMatchObject({ rows: 13, statutory: 11, govMakeupOff: 1, govBridgeOff: 1, added: 1 });
  });

  it('classifies manual rows: 公司休息日 -> company_off, weekend 補班日 -> company_workday, unknown names flagged', async () => {
    Holiday.__reset([
      { date: day('2026-07-03'), name: '院慶', type: '公司休息日', source: 'manual' },
      { date: day('2026-07-04'), name: '院內活動補班', type: '補班日', source: 'manual' },
      { date: day('2026-08-14'), name: '公司創立紀念日', type: '國定假日', source: 'manual' },
      { date: day('2026-09-25'), name: '中秋節', type: '國定假日', source: 'manual' },
    ]);

    const result = await migrateHolidayCalendarKinds();

    expect(rowOn('2026-07-03')).toMatchObject({ kind: 'company_off', origin: 'manual' });
    expect(rowOn('2026-07-04')).toMatchObject({ kind: 'company_workday', origin: 'manual' });
    expect(rowOn('2026-08-14')).toMatchObject({ kind: 'statutory', needsReview: true, reviewNote: '手動新增、名稱不在法定假日清單，請確認類型' });
    expect(rowOn('2026-09-25')).toMatchObject({ kind: 'statutory', statutoryKey: 'mid_autumn' });
    expect(result).toMatchObject({ companyOff: 1, workdays: 1, needsReview: 1, added: 0 });
  });

  it('archives same-day duplicates before activating the keeper', async () => {
    Holiday.__reset([
      { _id: 'a00000000000000000000001', date: day('2026-06-19'), name: '端午節', description: '端午節', type: '國定假日', source: 'roc-calendar' },
      { _id: 'a00000000000000000000002', date: day('2026-06-19'), name: '端午節', description: '端午節', type: '國定假日', source: 'manual' },
    ]);

    const result = await migrateHolidayCalendarKinds();

    expect(result.duplicates).toBe(1);
    expect(Holiday.__docs().find((row) => row._id === 'a00000000000000000000001')).toMatchObject({ kind: 'statutory', archived: false });
    expect(Holiday.__docs().find((row) => row._id === 'a00000000000000000000002')).toMatchObject({ kind: 'statutory', archived: true, reviewNote: '重複紀錄（轉換時封存）' });
    const calls = Holiday.updateOne.mock.calls.map(([filter, update]) => [filter._id, update.$set.archived]);
    expect(calls.findIndex(([id, archived]) => id === 'a00000000000000000000002' && archived === true))
      .toBeLessThan(calls.findIndex(([id, archived]) => id === 'a00000000000000000000001' && archived === false));
  });

  it('creates a migrated draft year and a review notice per year, without touching existing year documents', async () => {
    Holiday.__reset([...legacyImport(LEGACY_2026), ...legacyImport(LEGACY_2025)]);
    CalendarYear.__reset([{ year: 2025, state: 'approved', migrated: false }]);

    await migrateHolidayCalendarKinds();

    expect(CalendarYear.__docs().find((doc) => doc.year === 2026)).toMatchObject({ state: 'draft', migrated: true, source: { kind: 'migrated' } });
    expect(CalendarYear.__docs().find((doc) => doc.year === 2025)).toMatchObject({ state: 'approved', migrated: false });
    expect(CalendarNotice.__docs()).toEqual([expect.objectContaining({ type: 'migrated_review', year: 2026, dedupeKey: 'migrated:2026', status: 'open' })]);
  });

  it('is idempotent: the second run finds nothing to do', async () => {
    Holiday.__reset(legacyImport(LEGACY_2026));
    await migrateHolidayCalendarKinds();
    const writes = Holiday.updateOne.mock.calls.length;

    const second = await migrateHolidayCalendarKinds();

    expect(second.rows).toBe(0);
    expect(Holiday.updateOne.mock.calls.length).toBe(writes);
    expect(CalendarNotice.__docs()).toHaveLength(1);
  });

  it('counts resolutions and moves that now sit on non-statutory dates, without changing them', async () => {
    Holiday.__reset(legacyImport(LEGACY_2026));
    HolidayRestResolution.__reset([
      { employee: 'e1', holidayDate: day('2026-02-20'), kind: 'paid' },
      { employee: 'e1', holidayDate: day('2026-02-28'), kind: 'paid' },
    ]);
    HolidayMoveSetting.__reset([{ enableHolidayMove: true, sourceDate: day('2026-02-20'), targetDate: day('2026-02-24') }]);

    const result = await migrateHolidayCalendarKinds();

    expect(result.orphanResolutions).toBe(1);
    expect(result.orphanMoves).toBe(1);
    expect(await countOrphanHolidayResolutions()).toBe(1);
    expect(HolidayRestResolution.__docs()).toHaveLength(2);
    expect(HolidayRestResolution.updateOne).not.toHaveBeenCalled();
  });

  // 舊版一鍵載入一律存「國定假日」；類型被改成別的，只可能是管理員在舊畫面改過：重新匯入時預設保留
  it('marks old-UI admin edits of imported rows as HR edits that need review', async () => {
    Holiday.__reset([
      ...legacyImport(LEGACY_2026.filter(([date]) => date !== '2026-02-20')),
      { date: day('2026-02-20'), name: '春節補假（公司不放）', description: '春節補假（公司不放）', type: '公司休息日', source: 'roc-calendar' },
    ]);

    const result = await migrateHolidayCalendarKinds();

    expect(rowOn('2026-02-20')).toMatchObject({
      kind: 'company_off',
      origin: 'migrated',
      hrEdited: true,
      needsReview: true,
      reviewNote: '舊版畫面修改過，重新匯入預設保留，請確認類型',
    });
    // 沒改過的匯入資料維持 hrEdited=false
    expect(rowOn('2026-02-27')).toMatchObject({ kind: 'gov_makeup_off', hrEdited: false });
    expect(rowOn('2026-02-27').needsReview).toBeUndefined();
    expect(result).toMatchObject({ rows: 22, companyOff: 1, needsReview: 1 });
  });

  // 舊畫面改日期時類型、來源都不變：固定日期的國定假日出現在別的日期，只可能是管理員改過
  it('marks an old-UI date edit of a fixed-date national holiday as an HR edit that needs review', async () => {
    Holiday.__reset([
      ...legacyImport(LEGACY_2026.filter(([date]) => date !== '2026-10-10')),
      { date: day('2026-10-12'), name: '國慶日', description: '國慶日', desc: '國慶日', type: '國定假日', source: 'roc-calendar' },
    ]);

    await migrateHolidayCalendarKinds();

    expect(rowOn('2026-10-12')).toMatchObject({
      origin: 'migrated',
      hrEdited: true,
      needsReview: true,
      reviewNote: expect.stringContaining('舊版畫面修改過，重新匯入預設保留，請確認類型'),
    });
    // 原本日期的國定假日沒動過，不算管理員修改
    expect(rowOn('2026-01-01')).toMatchObject({ kind: 'statutory', hrEdited: false });
  });

  // 2026 年 1～8 月的舊版程式在 UTC+8 主機上存成前一天 16:00Z（2026-01-01 -> 2025-12-31T16:00Z）
  it('moves legacy dates stored at 16:00Z of the previous UTC day to their Taipei date before classifying', async () => {
    const shifted = (key) => new Date(new Date(`${key}T00:00:00.000Z`).getTime() - 8 * 3600000);
    Holiday.__reset(LEGACY_2026.map(([date, name]) => ({ date: shifted(date), name, description: name, desc: name, type: '國定假日', source: 'roc-calendar' })));

    const result = await migrateHolidayCalendarKinds();

    expect(result).toMatchObject({ rows: 22, years: 1, statutory: 16, govMakeupOff: 6, added: 0, needsReview: 0, normalizedDates: 22 });
    expect(Holiday.__docs().every((row) => new Date(row.date).toISOString().endsWith('T00:00:00.000Z'))).toBe(true);
    expect(rowOn('2026-01-01')).toMatchObject({ kind: 'statutory', year: 2026, statutoryKey: 'new_year' });
    expect(keyOf(rowOn('2026-02-20').compensatesDate)).toBe('2026-02-15');
    expect(keyOf(rowOn('2026-02-27').compensatesDate)).toBe('2026-02-28');
    // 沒有誤建 2025 年度、也沒有補上 2025 年的勞動節
    expect(CalendarYear.__docs().map((doc) => doc.year)).toEqual([2026]);
    expect(Holiday.__docs().some((row) => keyOf(row.date).startsWith('2025'))).toBe(false);
  });

  it('archives the collision when a shifted legacy row and a UTC-midnight row land on the same day', async () => {
    Holiday.__reset([
      { _id: 'b00000000000000000000001', date: day('2026-06-19'), name: '端午節', type: '國定假日', source: 'manual' },
      { _id: 'b00000000000000000000002', date: new Date('2026-06-18T16:00:00.000Z'), name: '端午節', type: '國定假日', source: 'roc-calendar' },
    ]);

    const result = await migrateHolidayCalendarKinds();

    expect(result).toMatchObject({ normalizedDates: 1, duplicates: 1 });
    expect(Holiday.__docs().filter((row) => keyOf(row.date) === '2026-06-19' && row.archived === false)).toHaveLength(1);
  });

  it('adds a derived 兒童節 on an empty-remark Saturday for an imported year (2021)', async () => {
    Holiday.__reset(legacyImport([
      ['2021-01-01', '開國紀念日'], ['2021-04-02', '補假'], ['2021-04-04', '兒童節及民族掃墓節'], ['2021-04-05', '補假'],
    ]));

    const result = await migrateHolidayCalendarKinds();

    expect(rowOn('2021-04-03')).toMatchObject({ kind: 'statutory', name: '兒童節', origin: 'rule' });
    expect(rowOn('2021-05-01')).toMatchObject({ kind: 'statutory', name: '勞動節', origin: 'rule' });
    expect(keyOf(rowOn('2021-04-02').compensatesDate)).toBe('2021-04-03');
    expect(result.added).toBe(2);
  });
});

describe('ensureHolidayCalendarIndexes', () => {
  it('builds every calendar index and reports failures by name only', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    CalendarNotice.createIndexes.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key: secret'), { name: 'MongoServerError' }));

    const result = await ensureHolidayCalendarIndexes();

    expect(result.errors).toEqual(['MongoServerError']);
    for (const model of [Holiday, CalendarYear, PublicCalendarSnapshot, CalendarNotice, CalendarSourceState, HolidayCompensation, HolidaySwap]) {
      expect(model.createIndexes).toHaveBeenCalledTimes(1);
    }
    expect(errorSpy).toHaveBeenCalledWith('Failed to ensure CalendarNotice indexes', 'MongoServerError');
    errorSpy.mockRestore();
  });
});
