import {
  DEFAULT_SCHEDULE_ACCESS_MODE,
  getScheduleAccessMode,
  ScheduleAccessSettingError,
  SCHEDULE_ACCESS_MODES,
  setScheduleAccessMode,
} from '../services/scheduleAccessService.js';

// 其他控制設定 > 排班權限：主管能不能因為是主管而排班（排班人員一律可以排被指定的小單位）。
// GET  /api/other-control-settings/schedule-access -> { mode, modes, defaultMode }
// PUT  /api/other-control-settings/schedule-access { mode } -> { mode, modes, defaultMode }

function describe(mode) {
  return { mode, modes: [...SCHEDULE_ACCESS_MODES], defaultMode: DEFAULT_SCHEDULE_ACCESS_MODE };
}

export async function getScheduleAccessSetting(req, res) {
  try {
    res.json(describe(await getScheduleAccessMode()));
  } catch (error) {
    console.error('[scheduleAccessSetting] read failed:', error?.name ?? 'Error');
    res.status(500).json({ error: '無法讀取排班權限設定，請稍後再試' });
  }
}

export async function updateScheduleAccessSetting(req, res) {
  try {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
    res.json(describe(await setScheduleAccessMode(mode)));
  } catch (error) {
    if (error instanceof ScheduleAccessSettingError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[scheduleAccessSetting] write failed:', error?.name ?? 'Error');
    return res.status(500).json({ error: '無法儲存排班權限設定，請稍後再試' });
  }
}
