import {
  DEFAULT_SCHEDULE_ACCESS_MODE,
  getScheduleAccessModeState,
  ScheduleAccessSettingError,
  SCHEDULE_ACCESS_MODES,
  setScheduleAccessMode,
} from '../services/scheduleAccessService.js';

// 其他控制設定 > 排班權限：主管能不能因為是主管而排班（排班人員一律可以排被指定的小單位）。
// 預設（沒有存過）是 scheduler_only：只有被指定的排班人員能排班，主管只負責簽核（仍看得到直屬部屬的簽核單、假別餘額與調休存摺）。
// GET  /api/other-control-settings/schedule-access -> { mode, modes, defaultMode, saved }（saved：false 代表沒有存過、用的是預設值）
// PUT  /api/other-control-settings/schedule-access { mode } -> { mode, modes, defaultMode, saved: true }

function describe(mode, saved) {
  return { mode, modes: [...SCHEDULE_ACCESS_MODES], defaultMode: DEFAULT_SCHEDULE_ACCESS_MODE, saved };
}

export async function getScheduleAccessSetting(req, res) {
  try {
    const { mode, saved } = await getScheduleAccessModeState();
    res.json(describe(mode, saved));
  } catch (error) {
    console.error('[scheduleAccessSetting] read failed:', error?.name ?? 'Error');
    res.status(500).json({ error: '無法讀取排班權限設定，請稍後再試' });
  }
}

export async function updateScheduleAccessSetting(req, res) {
  try {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
    res.json(describe(await setScheduleAccessMode(mode), true));
  } catch (error) {
    if (error instanceof ScheduleAccessSettingError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[scheduleAccessSetting] write failed:', error?.name ?? 'Error');
    return res.status(500).json({ error: '無法儲存排班權限設定，請稍後再試' });
  }
}
