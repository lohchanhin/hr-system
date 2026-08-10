import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_FONT = path.join(__dirname, '../../fonts/NotoSansCJKtc-Regular.otf');

const FONT_CANDIDATES = [
  process.env.PDF_CHINESE_FONT_PATH
    ? { path: process.env.PDF_CHINESE_FONT_PATH, postscriptName: process.env.PDF_CHINESE_FONT_NAME || undefined }
    : null,
  { path: BUNDLED_FONT },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', postscriptName: 'NotoSansCJKtc-Regular' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJKtc-Regular.otf' },
  { path: '/usr/share/fonts/truetype/noto/NotoSansTC-Regular.ttf' },
  { path: 'C:/Windows/Fonts/msjh.ttc', postscriptName: 'MicrosoftJhengHeiRegular' },
  { path: 'C:/Windows/Fonts/mingliu.ttc', postscriptName: 'PMingLiU' },
].filter(Boolean);

export function resolveTraditionalChinesePdfFont() {
  return FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate.path)) || null;
}

export function registerTraditionalChinesePdfFont(doc, name = 'TraditionalChinese') {
  const font = resolveTraditionalChinesePdfFont();
  if (!font) {
    throw new Error('Traditional Chinese PDF font is unavailable; run ./setup-fonts.sh or set PDF_CHINESE_FONT_PATH');
  }
  doc.registerFont(name, font.path, font.postscriptName);
  doc.font(name);
  return font;
}
