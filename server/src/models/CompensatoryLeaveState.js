import mongoose from 'mongoose';

export const COMPENSATORY_LEAVE_STATE_KEY = 'bank';

// 調休存摺的系統狀態（只有一筆，key = 'bank'）：
//   officeGovMakeupCutover    行政人員「公務機關補假日自動放假」停止的第一天（台灣日期 YYYY-MM-DD）。
//                             部署新版後第一次啟動時寫入「隔天」：之前的公務機關補假日照舊是行政人員的假日（已經放過的假、已經算過的薪資不變），
//                             這天（含）之後的公務機關補假日只是「建議調休日」，國定假日落在週末改為存入調休。
//   compensationsMigratedAt   舊的補假義務（HolidayCompensation）已轉入調休存摺
//   legacyHoursMigratedAt     員工資料的「補休時數」已轉入調休存摺（只做一次）
// 另外 key = 'filing:<員工 _id>' 的是送出調休申請時的短暫鎖（leaseToken、leaseUntil；用完即刪，程式中斷時過期自動失效）：
// 同一位員工的調休申請一次只處理一筆（檢查存摺到建立單據），同時送出兩筆不會一起超過存摺（單機 MongoDB 沒有交易，靠 key 的唯一索引）。
const compensatoryLeaveStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  officeGovMakeupCutover: { type: String, default: '' },
  compensationsMigratedAt: { type: Date, default: null },
  legacyHoursMigratedAt: { type: Date, default: null },
  leaseToken: { type: String, default: undefined },
  leaseUntil: { type: Date, default: undefined },
}, { timestamps: true });

export default mongoose.model('CompensatoryLeaveState', compensatoryLeaveStateSchema);
