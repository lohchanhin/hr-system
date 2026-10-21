import mongoose from 'mongoose';

// 行事曆資料來源的小型狀態紀錄（key/value）：
//   'dgpa-14718'         政府資料平台 dataset 14718 的檢查狀態（上次檢查、錯誤代碼、看過的檔案）
//   'daily-maintenance'  每日例行檢查的領取紀錄（多個 PM2 執行個體同一天只跑一次）
const resourceSchema = new mongoose.Schema({
  year: Number,
  description: String,
  url: String,
  firstSeenAt: Date,
}, { _id: false });

const calendarSourceStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  // 上次每日例行檢查的台灣日期 YYYY-MM-DD
  lastRunDay: { type: String, default: '' },
  lastRunAt: Date,
  lastCheckedAt: Date,
  lastSuccessAt: Date,
  // 簡短錯誤代碼（例如 FETCH_TIMEOUT、HTTP_503、BAD_METADATA），不存錯誤堆疊
  lastError: { type: String, default: '' },
  metadataModifiedDate: { type: String, default: '' },
  resources: { type: [resourceSchema], default: [] },
}, { timestamps: true });

export default mongoose.model('CalendarSourceState', calendarSourceStateSchema);
