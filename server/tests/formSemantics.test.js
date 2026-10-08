import mongoose from 'mongoose';
import FormTemplate from '../src/models/form_template.js';
import {
  explicitSemanticType,
  isLeaveFormTemplate,
  isOvertimeFormTemplate,
} from '../src/utils/formSemantics.js';

describe('form semantics: the form type wins, the name is only a fallback', () => {
  it('trusts semanticType when it is set, even when the name says otherwise', () => {
    expect(isOvertimeFormTemplate({ name: '加班費申請', semanticType: 'general' })).toBe(false);
    expect(isLeaveFormTemplate({ name: '請假 但不需要證明', semanticType: 'general' })).toBe(false);
    expect(isOvertimeFormTemplate({ name: '延長工時申請', semanticType: 'overtime' })).toBe(true);
    expect(isLeaveFormTemplate({ name: '休假/事假/公假申請單', semanticType: 'leave' })).toBe(true);
  });

  it('keeps the two types apart', () => {
    expect(isLeaveFormTemplate({ name: '加班申請', semanticType: 'overtime' })).toBe(false);
    expect(isOvertimeFormTemplate({ name: '請假', semanticType: 'leave' })).toBe(false);
    expect(isLeaveFormTemplate({ name: '請假', semanticType: 'shift_change' })).toBe(false);
  });

  it('is case and space tolerant about the stored type', () => {
    expect(isLeaveFormTemplate({ name: 'x', semanticType: ' Leave ' })).toBe(true);
  });

  it('falls back to the name only for templates without any type', () => {
    expect(isOvertimeFormTemplate({ name: '加班申請' })).toBe(true);
    expect(isOvertimeFormTemplate({ name: 'Overtime request' })).toBe(true);
    expect(isLeaveFormTemplate({ name: '請假' })).toBe(true);
    expect(isLeaveFormTemplate({ name: 'Leave form', semanticType: null })).toBe(true);
    expect(isLeaveFormTemplate({ name: '請假', semanticType: '' })).toBe(true);
    expect(isOvertimeFormTemplate({ name: '在職證明' })).toBe(false);
    expect(isLeaveFormTemplate({ name: '特休保留' })).toBe(false);
  });

  it('handles a missing form', () => {
    expect(isLeaveFormTemplate(undefined)).toBe(false);
    expect(isOvertimeFormTemplate(null)).toBe(false);
    expect(explicitSemanticType(undefined)).toBe('');
  });

  describe('with Mongoose documents', () => {
    const id = () => new mongoose.Types.ObjectId();

    it('treats the schema default of an old document that never stored a type as "no type"', () => {
      // 舊資料沒有 semanticType 欄位，Mongoose 讀出來會補上預設值 general，但那不是管理員的選擇
      const legacy = FormTemplate.hydrate({ _id: id(), name: '加班申請' });

      expect(legacy.semanticType).toBe('general');
      expect(explicitSemanticType(legacy)).toBe('');
      expect(isOvertimeFormTemplate(legacy)).toBe(true);
    });

    it('treats a stored "general" as the administrator\'s choice', () => {
      const chosen = FormTemplate.hydrate({ _id: id(), name: '加班費申請', semanticType: 'general' });

      expect(explicitSemanticType(chosen)).toBe('general');
      expect(isOvertimeFormTemplate(chosen)).toBe(false);
    });

    it('reads a stored type from lean-like and hydrated documents alike', () => {
      expect(isLeaveFormTemplate(FormTemplate.hydrate({ _id: id(), name: '員工請假單', semanticType: 'leave' }))).toBe(true);
      expect(isLeaveFormTemplate(FormTemplate.hydrate({ _id: id(), name: '請假', semanticType: 'general' }))).toBe(false);
    });
  });
});
