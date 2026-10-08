import mongoose from 'mongoose';

// 其他控制設定（字典項目、自訂欄位、表單分類、通知／資安／整合設定、自動化規則）
// 整份設定存成單一文件，data 內容由 services/otherControlSettingsStore.js 負責合併預設值與更新。
// revision 供樂觀鎖使用：多個程序同時修改設定時，後寫入的一方會重新讀取後再套用，避免互相覆蓋。
const otherControlSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    revision: { type: Number, default: 0 }
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model('OtherControlSetting', otherControlSettingSchema);
