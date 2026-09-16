// This file is a barrel: it re-exports the schedule controller's public API
// from the focused modules under ./schedule/. Route wiring (scheduleRoutes.js)
// and tests that mock this module's path continue to work unchanged; the
// actual logic now lives in ./schedule/*.
export {
  getIncludeSelfPreference,
  updateIncludeSelfPreference,
} from './schedule/schedulePreferenceController.js';

export {
  listMonthlySchedules,
  listLeaveApprovals,
  listSupervisorSummary,
  listScheduleOverview,
} from './schedule/scheduleQueryController.js';

export {
  createSchedulesBatch,
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  deleteOldSchedules,
  deleteSchedulesBatch,
} from './schedule/scheduleCrudController.js';

export {
  publishSchedules,
  finalizeSchedules,
  respondToSchedule,
  respondToSchedulesBulk,
} from './schedule/schedulePublishController.js';

export {
  listScheduleDayMemos,
  upsertScheduleDayMemo,
} from './schedule/scheduleMemoController.js';

export { importSchedules } from './schedule/scheduleImportController.js';

export {
  exportScheduleOverview,
  exportSchedules,
} from './schedule/scheduleExportController.js';

export {
  validateScheduleCompleteness,
  validateScheduleRules,
  getIncompleteSchedules,
  checkCanFinalize,
} from './schedule/scheduleValidationController.js';
