import {
  ANNUAL_LEAVE_TYPES,
  BONUS_FIELDS,
  BONUS_FORM_NAMES,
  LEAVE_POLICY,
  LEAVE_TYPE_PAY_TABLE,
  resolveLeavePay,
} from '../src/config/salaryConfig.js';

describe('leave type pay table', () => {
  it('lists every name once, so a leave type can not be both paid and unpaid', () => {
    const names = LEAVE_TYPE_PAY_TABLE.flatMap((rule) => rule.names);

    expect(new Set(names).size).toBe(names.length);
  });

  it('only uses the three pay rates: full, half and none', () => {
    expect(LEAVE_TYPE_PAY_TABLE.map((rule) => [rule.category, rule.payRate])).toEqual([
      ['paid', 1], ['sick', 0.5], ['unpaid', 0],
    ]);
  });

  it('derives the older LEAVE_POLICY lists from the table', () => {
    const namesOf = (category) => LEAVE_TYPE_PAY_TABLE.filter((rule) => rule.category === category).flatMap((rule) => rule.names);

    expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toEqual(namesOf('paid'));
    expect(LEAVE_POLICY.SICK_LEAVE_TYPES).toEqual(namesOf('sick'));
    expect(LEAVE_POLICY.UNPAID_LEAVE_TYPES).toEqual(namesOf('unpaid'));
    expect(LEAVE_POLICY.SICK_LEAVE_PAY_RATE).toBe(0.5);
    for (const name of ANNUAL_LEAVE_TYPES) expect(LEAVE_POLICY.PAID_LEAVE_TYPES).toContain(name);
  });

  it.each([
    ['特休', 'paid'], ['特休假', 'paid'], ['年假', 'paid'], ['公假', 'paid'], ['補休', 'paid'], ['休假', 'paid'],
    ['公傷假', 'paid'], ['婚假', 'paid'], ['喪假', 'paid'], ['產假', 'paid'], ['陪產假', 'paid'], ['產檢假', 'paid'],
    ['病假', 'sick'], ['生理假', 'sick'],
    ['事假', 'unpaid'], ['家庭照顧假', 'unpaid'], ['無薪假', 'unpaid'],
  ])('puts %s into the %s group', (name, category) => {
    expect(resolveLeavePay(name)).toMatchObject({ category, known: true, matchedName: name });
  });

  it('gives each group its rate', () => {
    expect(resolveLeavePay('特休假').payRate).toBe(1);
    expect(resolveLeavePay('病假').payRate).toBe(0.5);
    expect(resolveLeavePay('事假').payRate).toBe(0);
  });

  it('ignores spaces, width and brackets in the name', () => {
    expect(resolveLeavePay(' 特休假 ')).toMatchObject({ category: 'paid', matchedName: '特休假' });
    expect(resolveLeavePay('特休假（上午）')).toMatchObject({ category: 'paid', matchedName: '特休假' });
    expect(resolveLeavePay('病 假')).toMatchObject({ category: 'sick' });
  });

  it('takes the longest table name that the leave type contains', () => {
    // 含「病假」但是公傷病假；含「休假」但是無薪休假；含「產假」但是陪產假
    expect(resolveLeavePay('公傷病假')).toMatchObject({ category: 'paid', matchedName: '公傷病假' });
    expect(resolveLeavePay('無薪休假')).toMatchObject({ category: 'unpaid', matchedName: '無薪休假' });
    expect(resolveLeavePay('陪產假（5日）')).toMatchObject({ category: 'paid', matchedName: '陪產假' });
  });

  it('treats a name that is not in the table, or no name at all, as unpaid and says it is unknown', () => {
    expect(resolveLeavePay('颱風假')).toEqual({ category: 'unpaid', payRate: 0, matchedName: null, known: false });
    expect(resolveLeavePay('')).toMatchObject({ category: 'unpaid', known: false });
    expect(resolveLeavePay(undefined)).toMatchObject({ category: 'unpaid', known: false });
  });
});

describe('bonus form configuration', () => {
  it('only the default 獎金申請 template is a bonus form, and its amount / type fields are found by label', () => {
    expect(BONUS_FORM_NAMES).toEqual(['獎金申請']);
    expect(BONUS_FIELDS.amount).toContain('金額');
    expect(BONUS_FIELDS.type).toContain('獎金類型');
  });
});
