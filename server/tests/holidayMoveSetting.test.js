import { describe, expect, it } from '@jest/globals';
import HolidayMoveSetting from '../src/models/HolidayMoveSetting.js';

describe('HolidayMoveSetting', () => {
  it('keeps legacy feature-toggle records valid', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: false,
      needSignature: true,
      needMakeup: false,
    });

    await expect(setting.validate()).resolves.toBeUndefined();
    expect(setting.sourceDate).toBeNull();
    expect(setting.targetDate).toBeNull();
  });

  it('accepts and normalizes a national-holiday move within the same month', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07T10:30:00.000Z',
      targetDate: '2036-04-20T23:30:00.000Z',
      reason: 'CODEX_TEST_SAME_MONTH_MOVE',
    });

    await expect(setting.validate()).resolves.toBeUndefined();
    expect(setting.sourceDate.toISOString()).toBe('2036-04-07T00:00:00.000Z');
    expect(setting.targetDate.toISOString()).toBe('2036-04-20T00:00:00.000Z');
  });

  it('rejects moving a national holiday into another month', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-30',
      targetDate: '2036-05-01',
    });

    await expect(setting.validate()).rejects.toThrow('same month');
  });

  it('requires source and target dates together', async () => {
    const setting = new HolidayMoveSetting({
      enableHolidayMove: true,
      sourceDate: '2036-04-07',
    });

    await expect(setting.validate()).rejects.toThrow('provided together');
  });
});
