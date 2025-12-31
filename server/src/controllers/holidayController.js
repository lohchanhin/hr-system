import Holiday from '../models/Holiday.js';

// 設定年份限制與資料來源
const ROC_YEAR_MIN = 1900;
const ROC_YEAR_MAX = 2100;
const ROC_CALENDAR_BASE = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data';

/**
 * 標準化假日資料 (修正日期格式與名稱對應)
 */
function normalizeHolidayPayload(payload = {}) {
  let dateValue = null;
  
  if (payload.date) {
    let dateStr = payload.date.toString();
    
    // 關鍵：處理 20250101 格式 -> 轉為 2025-01-01
    if (dateStr.length === 8 && !dateStr.includes('-')) {
      const y = dateStr.substring(0, 4);
      const m = dateStr.substring(4, 6);
      const d = dateStr.substring(6, 8);
      dateStr = `${y}-${m}-${d}`;
    }
    
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      // 關鍵：強制設為該日凌晨 0 點，避免資料庫時區偏差造成的重複或錯誤
      d.setHours(0, 0, 0, 0); 
      dateValue = d;
    }
  }

  // 根據你的 JSON 範例：名稱主要在 description 欄位
  const name = payload.description || payload.name || payload.holidayCategory || '假日';
  const desc = payload.description || payload.remark || payload.name || '';

  return {
    name: name.trim() || '未命名假日',
    date: dateValue,
    type: payload.holidayCategory || (payload.isHoliday ? '國定假日' : '工作日'),
    desc: desc,
    description: desc,
    source: payload.source || 'manual',
  };
}

/**
 * 檢查日期是否有效
 */
function isValidDateValue(dateValue) {
  return dateValue instanceof Date && !Number.isNaN(dateValue.getTime());
}

// ------------------------------------------------------------------
// 控制器 (Controllers)
// ------------------------------------------------------------------

// 1. 列出所有假日
export async function listHolidays(_req, res) {
  try {
    const holidays = await Holiday.find().sort({ date: 1 });
    console.log(`[Holiday] 成功查詢清單，共 ${holidays.length} 筆資料`);
    res.json(holidays);
  } catch (err) {
    console.error('[Holiday] 查詢失敗:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// 2. 手動建立假日
export async function createHoliday(req, res) {
  try {
    const payload = normalizeHolidayPayload(req.body);
    if (!isValidDateValue(payload.date)) {
      return res.status(400).json({ error: '無效的日期格式' });
    }
    const holiday = await Holiday.create(payload);
    console.log(`[Holiday] 手動建立成功: ${payload.name}`);
    res.status(201).json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// 3. 更新假日
export async function updateHoliday(req, res) {
  try {
    const payload = normalizeHolidayPayload(req.body);
    const holiday = await Holiday.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!holiday) return res.status(404).json({ error: '找不到該資料' });
    console.log(`[Holiday] 資料更新成功: ${holiday.name}`);
    res.json(holiday);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// 4. 刪除假日
export async function deleteHoliday(req, res) {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) return res.status(404).json({ error: '找不到該資料' });
    console.log(`[Holiday] 資料已刪除`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// ------------------------------------------------------------------
// 外部資料導入 (關鍵功能)
// ------------------------------------------------------------------

export async function importRocHolidays(req, res) {
  const rawYear = req.query.year;
  const currentYear = new Date().getFullYear();
  const year = rawYear ? Number.parseInt(rawYear, 10) : currentYear;

  console.log(`\n--- [Import Task Start: ${year}] ---`);

  if (Number.isNaN(year) || year < ROC_YEAR_MIN || year > ROC_YEAR_MAX) {
    console.warn(`[Import] 錯誤: 年份 ${year} 不在範圍內`);
    return res.status(400).json({ error: 'Year range invalid' });
  }

  const url = `${ROC_CALENDAR_BASE}/${year}.json`;
  console.log(`[Import] 正在連接: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`遠端連線失敗: ${response.status}`);
    
    const rawData = await response.json();
    console.log(`[Import] 下載完成，原始資料共 ${rawData.length} 筆`);

    // 關鍵修正：對應你的 JSON 格式 (isHoliday 為布林值 true)
    const holidaysToProcess = rawData
      .filter((item) => {
        // 同時兼容布林值 true 與字串 'Y'
        const isHoliday = item.isHoliday === true || item.isHoliday === 'Y';
        return isHoliday && item.date;
      })
      .map((item) => normalizeHolidayPayload({ ...item, source: 'roc-calendar' }));

    console.log(`[Import] 篩選完成，準備存入 ${holidaysToProcess.length} 筆放假日`);

    if (holidaysToProcess.length === 0) {
      console.warn('[Import] 警告：篩選結果為 0，請確認 JSON 中的 isHoliday 欄位類型');
    }

    // 執行資料庫同步 (使用 Upsert)
    const saveResults = await Promise.all(
      holidaysToProcess.map(async (holiday) => {
        try {
          return await Holiday.findOneAndUpdate(
            { date: holiday.date }, // 以日期為唯一鍵
            holiday,
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );
        } catch (dbErr) {
          console.error(`[Import] 寫入失敗 (${holiday.date}):`, dbErr.message);
          return null;
        }
      })
    );

    const successfulSaves = saveResults.filter(Boolean);
    console.log(`[Import] 同步任務結束，成功更新 ${successfulSaves.length} 筆假日`);
    console.log(`--- [Import Task End] ---\n`);

    res.json({
      success: true,
      year,
      count: successfulSaves.length,
      holidays: successfulSaves
    });
  } catch (err) {
    console.error('[Import] 重大錯誤:', err.message);
    res.status(500).json({ error: err.message });
  }
}