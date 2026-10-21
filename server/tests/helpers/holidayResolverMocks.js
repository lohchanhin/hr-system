// 國定假日判斷（services/holidayResolver.js）新用到的三個模型的測試替身。
// loadHolidayContext 一定會查 CalendarYear（有員工 id 時還會查補假與個人調移）；測試沒有連線資料庫，
// 沒有替身的話 mongoose 會一直等待連線而讓測試逾時。用法（要在 import 受測模組之前）：
//   const { CalendarYear } = await registerHolidayResolverModelMocks(jest);
//   CalendarYear.__setRows([{ year: 2026, state: 'approved' }]);
// srcPath 是相對於「呼叫的測試檔」的 src 路徑（tests/ 底下的測試用預設值即可）。

function createModelMock(jest) {
  let rows = [];
  const chain = (resolveValue) => {
    const query = {
      lean: jest.fn(() => query),
      select: jest.fn(() => query),
      sort: jest.fn(() => query),
      populate: jest.fn(() => query),
      limit: jest.fn(() => query),
      skip: jest.fn(() => query),
      session: jest.fn(() => query),
      exec: jest.fn(() => Promise.resolve(resolveValue())),
      then: (onFulfilled, onRejected) => Promise.resolve(resolveValue()).then(onFulfilled, onRejected),
      catch: (onRejected) => Promise.resolve(resolveValue()).catch(onRejected),
      finally: (onFinally) => Promise.resolve(resolveValue()).finally(onFinally),
    };
    return query;
  };
  const model = {
    find: jest.fn(() => chain(() => [...rows])),
    findOne: jest.fn(() => chain(() => rows[0] ?? null)),
    findById: jest.fn(() => chain(() => null)),
    exists: jest.fn(() => chain(() => null)),
    countDocuments: jest.fn(() => chain(() => rows.length)),
    distinct: jest.fn(() => chain(() => [])),
    create: jest.fn(async (doc) => doc),
    findOneAndUpdate: jest.fn(() => chain(() => null)),
    updateOne: jest.fn(async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 })),
    updateMany: jest.fn(async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 })),
    bulkWrite: jest.fn(async () => ({ insertedCount: 0, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 })),
    createIndexes: jest.fn(async () => undefined),
    __setRows(list) {
      rows = Array.isArray(list) ? list : [];
    },
    __getRows() {
      return rows;
    },
  };
  return model;
}

export async function registerHolidayResolverModelMocks(jest, { srcPath = '../src' } = {}) {
  const CalendarYear = createModelMock(jest);
  const HolidayCompensation = createModelMock(jest);
  const HolidaySwap = createModelMock(jest);
  await jest.unstable_mockModule(`${srcPath}/models/CalendarYear.js`, () => ({ default: CalendarYear }));
  await jest.unstable_mockModule(`${srcPath}/models/HolidayCompensation.js`, () => ({
    default: HolidayCompensation,
    HOLIDAY_COMPENSATION_STATUSES: ['open', 'assigned', 'void'],
    HOLIDAY_COMPENSATION_ORIGINS: ['roster_rest_day', 'office_weekend', 'manual'],
    HOLIDAY_COMPENSATION_VOID_REASONS: ['covered_by_roster', 'roster_changed', 'holiday_removed', 'not_applicable', 'manual'],
  }));
  await jest.unstable_mockModule(`${srcPath}/models/HolidaySwap.js`, () => ({
    default: HolidaySwap,
    HOLIDAY_SWAP_STATUSES: ['active', 'revoked'],
    CONSENT_METHODS: ['signature', 'written_form', 'electronic'],
  }));
  return { CalendarYear, HolidayCompensation, HolidaySwap };
}
