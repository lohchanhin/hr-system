import FormTemplate from '../models/form_template.js';
import FormField from '../models/form_field.js';

let leaveFieldCache = null;

function normalizeOption(value, label) {
  if (value === undefined || value === null) return null;
  const normalizedValue = String(value);
  const normalizedLabel = label !== undefined && label !== null ? String(label) : normalizedValue;
  return { value: normalizedValue, label: normalizedLabel };
}

function extractOptions(field) {
  const { options } = field ?? {};
  if (!options) return [];

  const results = [];
  const pushOption = (value, label) => {
    const option = normalizeOption(value, label);
    if (option) results.push(option);
  };

  if (Array.isArray(options)) {
    options.forEach((opt) => {
      if (opt === undefined || opt === null) return;
      if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
        pushOption(opt, opt);
      } else if (typeof opt === 'object') {
        const value = opt.value ?? opt.code ?? opt.id ?? opt._id ?? opt.key;
        const label =
          opt.label ?? opt.name ?? opt.title ?? opt.text ?? opt.display ?? opt.caption ?? value;
        pushOption(value ?? label, label ?? value);
      }
    });
  } else if (typeof options === 'object') {
    if (Array.isArray(options.choices)) {
      options.choices.forEach((choice) => {
        if (choice === undefined || choice === null) return;
        if (typeof choice === 'string' || typeof choice === 'number') {
          pushOption(choice, choice);
        } else if (typeof choice === 'object') {
          const value = choice.value ?? choice.code ?? choice.id ?? choice._id ?? choice.key;
          const label =
            choice.label ?? choice.name ?? choice.title ?? choice.text ?? choice.display ?? value;
          pushOption(value ?? label, label ?? value);
        }
      });
    } else {
      Object.entries(options).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (typeof value === 'string' || typeof value === 'number') {
          pushOption(key, value);
        } else if (typeof value === 'object') {
          const optValue = value.value ?? value.code ?? value.id ?? value._id ?? key;
          const optLabel =
            value.label ?? value.name ?? value.title ?? value.text ?? value.display ?? value.value;
          pushOption(optValue ?? optLabel ?? key, optLabel ?? optValue ?? key);
        } else {
          pushOption(key, value);
        }
      });
    }
  }

  const seen = new Set();
  return results.filter((opt) => {
    if (seen.has(opt.value)) return false;
    seen.add(opt.value);
    return true;
  });
}

export function resetLeaveFieldCache() {
  leaveFieldCache = null;
}

export async function getLeaveFieldIds() {
  if (leaveFieldCache) return leaveFieldCache;

  const form = await FormTemplate.findOne({ name: '請假' }).lean();
  if (!form) {
    leaveFieldCache = {};
    return leaveFieldCache;
  }

  const fields = await FormField.find({ form: form._id }).lean();
  // Support both old (開始日期) and new (開始時間) field names for backward compatibility
  const startField = fields.find((f) => f.label === '開始時間' || f.label === '開始日期');
  const endField = fields.find((f) => f.label === '結束時間' || f.label === '結束日期');
  const typeField = fields.find((f) => f.label === '假別');

  leaveFieldCache = {
    formId: form._id?.toString(),
    startId: startField?._id?.toString(),
    endId: endField?._id?.toString(),
    typeId: typeField?._id?.toString(),
    typeOptions: typeField ? extractOptions(typeField) : [],
    // Store the actual field labels for reference
    startLabel: startField?.label,
    endLabel: endField?.label,
  };

  return leaveFieldCache;
}

export async function getLeaveFieldConfig() {
  return getLeaveFieldIds();
}
