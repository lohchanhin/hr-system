import mongoose from 'mongoose';

// 給管理員的行事曆提醒（政府公告新年度、有新版本、同年度多份檔案、舊資料待核定、明年尚未核定）。
// dedupeKey 唯一：同一件事只會提醒一次，重複檢查不會再新增。
export const CALENDAR_NOTICE_TYPES = [
  'new_year_available',
  'revision_available',
  'multiple_resources',
  'migrated_review',
  'year_not_approved',
];

const calendarNoticeSchema = new mongoose.Schema({
  type: { type: String, enum: CALENDAR_NOTICE_TYPES, required: true },
  year: { type: Number, required: true },
  dedupeKey: { type: String, required: true, unique: true },
  message: { type: String, default: '' },
  snapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'PublicCalendarSnapshot', default: null },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

calendarNoticeSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('CalendarNotice', calendarNoticeSchema);
