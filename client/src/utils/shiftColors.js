const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const SHIFT_PALETTE = [
  { bg: '#dbeafe', text: '#1e3a8a' },
  { bg: '#ede9fe', text: '#5b21b6' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#dcfce7', text: '#047857' },
  { bg: '#fee2e2', text: '#991b1b' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#cffafe', text: '#155e75' },
  { bg: '#fae8ff', text: '#6b21a8' },
];

function normalizeHex(color) {
  if (typeof color !== 'string') return null;
  const trimmed = color.trim();
  if (!HEX_REGEX.test(trimmed)) return null;
  if (trimmed.length === 4) {
    return `#${trimmed
      .slice(1)
      .split('')
      .map((ch) => ch + ch)
      .join('')}`;
  }
  return trimmed.toLowerCase();
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  const int = parseInt(value, 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return `#${toHex(Math.min(255, Math.max(0, Math.round(r))))}${toHex(
    Math.min(255, Math.max(0, Math.round(g)))
  )}${toHex(Math.min(255, Math.max(0, Math.round(b))))}`;
}

function mix(hex, target, ratio) {
  const base = hexToRgb(hex);
  const mixin = hexToRgb(target);
  if (!base || !mixin) return normalizeHex(hex) || normalizeHex(target);
  const clamped = Math.min(1, Math.max(0, ratio));
  return rgbToHex({
    r: base.r + (mixin.r - base.r) * clamped,
    g: base.g + (mixin.g - base.g) * clamped,
    b: base.b + (mixin.b - base.b) * clamped,
  });
}

function lighten(hex, ratio) {
  return mix(hex, '#ffffff', ratio);
}

function darken(hex, ratio) {
  return mix(hex, '#000000', ratio);
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const transform = (value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const r = transform(rgb.r);
  const g = transform(rgb.g);
  const b = transform(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastColor(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return '#1f2937';
  return luminance(normalized) > 0.65 ? '#1f2937' : '#f8fafc';
}

function buildKey(shift = {}) {
  const { _id, id, code, name } = shift;
  return [shift.bgColor, shift.color, _id, id, code, name]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .join('|');
}

function hashKey(key) {
  let hash = 0;
  const input = key || 'shift';
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function resolveShiftBaseColors(shift) {
  if (!shift) {
    return { base: null, text: null };
  }
  const customBg = normalizeHex(shift.bgColor);
  const customText = normalizeHex(shift.color);
  if (customBg) {
    return {
      base: customBg,
      text: customText || getContrastColor(customBg),
    };
  }
  const key = buildKey(shift);
  const paletteIndex = hashKey(key) % SHIFT_PALETTE.length;
  const palette = SHIFT_PALETTE[paletteIndex];
  return {
    base: palette.bg,
    text: customText || palette.text,
  };
}

export function buildShiftStyle(shift) {
  const { base, text } = resolveShiftBaseColors(shift);
  if (!base) {
    return {};
  }
  const tagBg = lighten(base, 0.1);
  const cellStart = lighten(base, 0.18);
  const cellEnd = lighten(base, 0.32);
  const border = darken(base, 0.18);
  return {
    '--shift-base-color': base,
    '--shift-text-color': text,
    '--shift-tag-bg': tagBg,
    '--shift-cell-bg-start': cellStart,
    '--shift-cell-bg-end': cellEnd,
    '--shift-border-color': border,
  };
}

export function __testUtils() {
  return {
    normalizeHex,
    hexToRgb,
    rgbToHex,
    lighten,
    darken,
    luminance,
    getContrastColor,
    buildKey,
    hashKey,
    SHIFT_PALETTE,
  };
}
