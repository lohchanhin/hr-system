import { jest } from '@jest/globals';

const mockFormField = { find: jest.fn() };
jest.unstable_mockModule('../models/form_field.js', () => ({ default: mockFormField }));

const {
  aggregateBonusFromApprovals,
  approvalFinishedAt,
  extractNumericAmount,
  isBonusForm,
  loadBonusFieldsByForm,
} = await import('./payrollPreviewUtils.js');

// 預設「獎金申請」範本的欄位；form_data 以欄位 ID 為鍵
const BONUS_FORM = { _id: 'bonus-form', name: '獎金申請' };
const BONUS_FIELDS = [
  { _id: 'f-type', form: 'bonus-form', label: '獎金類型', type_1: 'text', order: 1 },
  { _id: 'f-amount', form: 'bonus-form', label: '金額', type_1: 'number', order: 2 },
  { _id: 'f-reason', form: 'bonus-form', label: '事由', type_1: 'textarea', order: 3 },
];
const fieldsByForm = new Map([['bonus-form', BONUS_FIELDS]]);

const bonusRequest = (type, amount, extra = {}) => ({
  form: BONUS_FORM,
  form_data: { 'f-type': type, 'f-amount': amount, 'f-reason': '年度表現' },
  ...extra,
});

// 審核通過但不是獎金的表單：特休保留的年度是文字 '2026'、請假事由寫了 '3'
const RETENTION_REQUEST = {
  form: { _id: 'retention-form', name: '特休保留' },
  form_data: { 'r-year': '2026', 'r-days': 3, 'r-reason': '專案忙碌' },
};
const LEAVE_REQUEST = {
  form: { _id: 'leave-form', name: '請假', semanticType: 'leave' },
  form_data: { 'l-type': '事假', 'l-start': '2026-10-05T01:00:00.000Z', 'l-end': '2026-10-05T10:00:00.000Z', 'l-reason': '3' },
};

describe('extractNumericAmount', () => {
  it('reads the configured direct keys', () => {
    expect(extractNumericAmount({ amount: '1500', note: 'ignore' })).toBe(1500);
    expect(extractNumericAmount({ 金額: 800 })).toBe(800);
    expect(extractNumericAmount({ nullValue: null, amount: 2000 })).toBe(2000);
    expect(extractNumericAmount({ amount: 5000, startDate: new Date('2024-12-01') })).toBe(5000);
    expect(extractNumericAmount({})).toBe(0);
  });

  it('never falls back to "the first numeric-looking value" of some other field', () => {
    expect(extractNumericAmount({ description: 'none', extra: '3000' })).toBe(0);
    expect(extractNumericAmount({ 年度: '2026', 保留天數: 3 })).toBe(0);
    expect(extractNumericAmount({ startDate: new Date('2024-12-01'), endDate: new Date() })).toBe(0);
  });
});

describe('isBonusForm', () => {
  it('recognises the default 獎金申請 template by name or default_key, and an explicit bonus type', () => {
    expect(isBonusForm({ name: '獎金申請' })).toBe(true);
    expect(isBonusForm({ name: ' 獎金申請 ' })).toBe(true);
    expect(isBonusForm({ name: '客戶自訂獎金', default_key: '獎金申請' })).toBe(true);
    expect(isBonusForm({ name: '年終獎金單', semanticType: 'bonus' })).toBe(true);
  });

  it('does not take other forms for bonus forms, whatever numbers they hold', () => {
    expect(isBonusForm({ name: '特休保留' })).toBe(false);
    expect(isBonusForm({ name: '請假', semanticType: 'leave' })).toBe(false);
    expect(isBonusForm({ name: '績效獎金檢討會議申請' })).toBe(false);
    expect(isBonusForm(null)).toBe(false);
    expect(isBonusForm('bonus-form')).toBe(false);
  });
});

describe('aggregateBonusFromApprovals', () => {
  it('puts an approved 績效獎金 request into performanceBonus, read from the 金額 field by field id', () => {
    const result = aggregateBonusFromApprovals([bonusRequest('績效獎金', 5000)], { fieldsByForm });

    expect(result).toEqual({ performanceBonus: 5000 });
  });

  it('classifies by the 獎金類型 field: 夜班 / night, 績效 / performance, everything else', () => {
    const result = aggregateBonusFromApprovals([
      bonusRequest('夜班津貼', 500),
      bonusRequest('績效獎金', 1200),
      bonusRequest('專案獎金', 3000),
      bonusRequest('Performance bonus', 100),
      bonusRequest('', 40),
    ], { fieldsByForm });

    expect(result).toEqual({ nightShiftAllowance: 500, performanceBonus: 1300, otherBonuses: 3040 });
  });

  it('does not add up numbers of unrelated approved forms (the 特休保留 年度 "2026" is not a bonus)', () => {
    expect(aggregateBonusFromApprovals([RETENTION_REQUEST], { fieldsByForm })).toEqual({});
    expect(aggregateBonusFromApprovals([RETENTION_REQUEST])).toEqual({});
    expect(aggregateBonusFromApprovals([LEAVE_REQUEST], { fieldsByForm })).toEqual({});
  });

  it('adds only the bonus request when it comes together with unrelated approvals (5000, not 7026)', () => {
    const result = aggregateBonusFromApprovals(
      [RETENTION_REQUEST, bonusRequest('績效獎金', 5000), LEAVE_REQUEST],
      { fieldsByForm },
    );

    expect(result).toEqual({ performanceBonus: 5000 });
  });

  it('returns nothing at all when there is no bonus request, so callers cannot wipe configured bonuses with zeros', () => {
    expect(aggregateBonusFromApprovals([])).toEqual({});
    expect(aggregateBonusFromApprovals(undefined)).toEqual({});
    expect(aggregateBonusFromApprovals([LEAVE_REQUEST, RETENTION_REQUEST], { fieldsByForm })).toEqual({});
    expect(aggregateBonusFromApprovals([bonusRequest('績效獎金', 0)], { fieldsByForm })).toEqual({});
  });

  it('ignores a request without an amount, a negative amount and an unreadable amount', () => {
    const result = aggregateBonusFromApprovals([
      bonusRequest('績效獎金', ''),
      bonusRequest('績效獎金', -300),
      bonusRequest('績效獎金', '不是數字'),
      { form: BONUS_FORM, form_data: { 'f-type': '績效獎金' } },
      bonusRequest('績效獎金', '1,200'),
    ], { fieldsByForm });

    expect(result).toEqual({});
  });

  it('does not take the 事由 text or any other field for the amount when the 金額 field is empty', () => {
    const request = { form: BONUS_FORM, form_data: { 'f-type': '績效獎金', 'f-amount': '', 'f-reason': '5000' } };

    expect(aggregateBonusFromApprovals([request], { fieldsByForm })).toEqual({});
  });

  it('prefers the active field when a deactivated field has the same label', () => {
    const fields = new Map([['bonus-form', [
      { _id: 'old-amount', label: '金額', is_active: false, order: 0 },
      ...BONUS_FIELDS,
    ]]]);

    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { 'old-amount': 999, 'f-type': '其他', 'f-amount': 400 } },
    ], { fieldsByForm: fields });

    expect(result).toEqual({ otherBonuses: 400 });
  });

  it('accepts fieldsByForm as a plain object too', () => {
    expect(aggregateBonusFromApprovals([bonusRequest('績效獎金', 700)], { fieldsByForm: { 'bonus-form': BONUS_FIELDS } }))
      .toEqual({ performanceBonus: 700 });
  });

  it('reads old data stored under the label keys', () => {
    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { bonusType: '專案獎金', 金額: 3000 } },
      { form: BONUS_FORM, form_data: { bonusType: '夜班津貼', amount: '500' } },
    ], { fieldsByForm });

    expect(result).toEqual({ otherBonuses: 3000, nightShiftAllowance: 500 });
  });

  describe('without field definitions (callers that do not pass fieldsByForm)', () => {
    it('takes the only number of a bonus request; without the fields the type cannot be told, so it counts as 其他獎金', () => {
      const result = aggregateBonusFromApprovals([bonusRequest('績效獎金', 5000), bonusRequest('夜班津貼', 300)]);

      expect(result).toEqual({ otherBonuses: 5300 });
    });

    it('refuses to guess when a bonus request holds several numbers or only numeric text', () => {
      expect(aggregateBonusFromApprovals([{ form: BONUS_FORM, form_data: { a: 100, b: 200 } }])).toEqual({});
      expect(aggregateBonusFromApprovals([{ form: BONUS_FORM, form_data: { a: '100', b: '2026' } }])).toEqual({});
    });

    it('needs the form to be populated to know it is a bonus form', () => {
      expect(aggregateBonusFromApprovals([{ form: 'bonus-form', form_data: { 'f-amount': 5000 } }], { fieldsByForm })).toEqual({});
      expect(aggregateBonusFromApprovals([{ form_data: { 金額: 5000 } }])).toEqual({});
    });
  });

  describe('keeping the bonuses configured for the employee', () => {
    const employee = { monthlySalaryAdjustments: { performanceBonus: 5000, otherBonuses: 1000 } };

    it('adds the approved amount to the configured one instead of replacing it', () => {
      const result = aggregateBonusFromApprovals([bonusRequest('績效獎金', 3000)], { fieldsByForm, employee });

      expect(result).toEqual({ performanceBonus: 8000 });
    });

    it('leaves the keys without an approved amount out, so the configured value stays', () => {
      const result = aggregateBonusFromApprovals([bonusRequest('績效獎金', 3000)], { fieldsByForm, employee });

      expect(result).not.toHaveProperty('otherBonuses');
      expect(result).not.toHaveProperty('nightShiftAllowance');
    });

    it('does not touch the configured bonuses when an unrelated request was approved in the month', () => {
      expect(aggregateBonusFromApprovals([LEAVE_REQUEST, RETENTION_REQUEST], { fieldsByForm, employee })).toEqual({});
    });

    it('adds an approved 夜班 amount to the calculated night shift allowance', () => {
      const result = aggregateBonusFromApprovals([bonusRequest('夜班津貼', 200)], {
        fieldsByForm, employee, workData: { nightShiftAllowance: 1800 },
      });

      expect(result).toEqual({ nightShiftAllowance: 2000 });
    });

    it('works for an employee without any adjustment settings', () => {
      expect(aggregateBonusFromApprovals([bonusRequest('其他', 400)], { fieldsByForm, employee: {} })).toEqual({ otherBonuses: 400 });
    });
  });

  describe('range', () => {
    const finished = (iso) => ({ logs: [{ action: 'create', at: new Date('2026-09-01') }, { action: 'finish', at: new Date(iso) }] });
    const range = { start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-11-01T00:00:00.000Z') };

    it('only counts requests that were approved inside the range (filed in September, approved in October counts for October)', () => {
      const result = aggregateBonusFromApprovals([
        bonusRequest('績效獎金', 1000, { createdAt: new Date('2026-09-28'), ...finished('2026-10-02T03:00:00.000Z') }),
        bonusRequest('績效獎金', 2000, { createdAt: new Date('2026-10-28'), ...finished('2026-11-03T03:00:00.000Z') }),
        bonusRequest('績效獎金', 4000, { createdAt: new Date('2026-09-10'), ...finished('2026-09-15T03:00:00.000Z') }),
      ], { fieldsByForm, range });

      expect(result).toEqual({ performanceBonus: 1000 });
    });

    it('takes the approval time from the finish log, then updatedAt, then createdAt', () => {
      expect(approvalFinishedAt(finished('2026-10-02T03:00:00.000Z'))).toEqual(new Date('2026-10-02T03:00:00.000Z'));
      expect(approvalFinishedAt({ updatedAt: '2026-10-05T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' })).toEqual(new Date('2026-10-05T00:00:00.000Z'));
      expect(approvalFinishedAt({ createdAt: '2026-10-01T00:00:00.000Z' })).toEqual(new Date('2026-10-01T00:00:00.000Z'));
      expect(approvalFinishedAt({})).toBeNull();
    });
  });
});

describe('loadBonusFieldsByForm', () => {
  beforeEach(() => mockFormField.find.mockReset());

  it('loads the fields of the bonus forms only, grouped by form', async () => {
    mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(BONUS_FIELDS) });

    const map = await loadBonusFieldsByForm([bonusRequest('績效獎金', 5000), bonusRequest('夜班津貼', 300), LEAVE_REQUEST, RETENTION_REQUEST]);

    expect(mockFormField.find).toHaveBeenCalledTimes(1);
    expect(mockFormField.find).toHaveBeenCalledWith({ form: { $in: ['bonus-form'] } });
    expect(map.get('bonus-form')).toEqual(BONUS_FIELDS);
  });

  it('does not query anything when no approval belongs to a bonus form', async () => {
    const map = await loadBonusFieldsByForm([LEAVE_REQUEST, RETENTION_REQUEST]);

    expect(map.size).toBe(0);
    expect(mockFormField.find).not.toHaveBeenCalled();
  });

  it('works with the aggregation', async () => {
    mockFormField.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(BONUS_FIELDS) });
    const approvals = [RETENTION_REQUEST, bonusRequest('績效獎金', 5000)];

    const result = aggregateBonusFromApprovals(approvals, { fieldsByForm: await loadBonusFieldsByForm(approvals) });

    expect(result).toEqual({ performanceBonus: 5000 });
  });
});

// 欄位被停用（有單據時刪除欄位會改為停用）或換成同標籤的新欄位後，舊獎金申請的答案還在舊欄位 ID 底下
describe('bonus requests answered under retired fields', () => {
  // 金額、獎金類型欄位都被換成同標籤的新欄位；舊欄位停用但保留
  const REPLACED_FIELDS = new Map([['bonus-form', [
    { _id: 'old-type', label: '獎金類型', is_active: false, order: 1 },
    { _id: 'old-amount', label: '金額', is_active: false, order: 2 },
    { _id: 'new-type', label: '獎金類型', order: 3 },
    { _id: 'new-amount', label: '金額', order: 4 },
  ]]]);

  it('reads the amount and the type of an old request from the retired fields', () => {
    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { 'old-type': '績效獎金', 'old-amount': 5000 } },
    ], { fieldsByForm: REPLACED_FIELDS });

    expect(result).toEqual({ performanceBonus: 5000 });
  });

  it('reads old and new requests of the same form, each from its own field', () => {
    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { 'old-type': '績效獎金', 'old-amount': 5000 } },
      { form: BONUS_FORM, form_data: { 'new-type': '夜班津貼', 'new-amount': 300 } },
      { form: BONUS_FORM, form_data: { 'new-type': '專案獎金', 'new-amount': '1200' } },
    ], { fieldsByForm: REPLACED_FIELDS });

    expect(result).toEqual({ performanceBonus: 5000, nightShiftAllowance: 300, otherBonuses: 1200 });
  });

  it('prefers the active field when a request has an answer under both, and an empty active answer falls back to the retired one', () => {
    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { 'old-type': '績效獎金', 'old-amount': 999, 'new-type': '其他', 'new-amount': 400 } },
      { form: BONUS_FORM, form_data: { 'old-type': '績效獎金', 'old-amount': 700, 'new-type': '', 'new-amount': '' } },
    ], { fieldsByForm: REPLACED_FIELDS });

    expect(result).toEqual({ otherBonuses: 400, performanceBonus: 700 });
  });

  it('adds a request from a retired field to the configured bonus, like any other request', () => {
    const employee = { monthlySalaryAdjustments: { performanceBonus: 3000, otherBonuses: 1000 } };

    const result = aggregateBonusFromApprovals([
      { form: BONUS_FORM, form_data: { 'old-type': '績效獎金', 'old-amount': 2000 } },
    ], { fieldsByForm: REPLACED_FIELDS, employee });

    expect(result).toEqual({ performanceBonus: 5000 });
  });
});
