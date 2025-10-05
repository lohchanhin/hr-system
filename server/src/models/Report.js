import mongoose from 'mongoose';

const exportSettingsSchema = new mongoose.Schema(
  {
    formats: {
      type: [String],
      default: [],
      set: (values) =>
        Array.isArray(values)
          ? values
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter(Boolean)
          : [],
    },
    includeLogo: { type: Boolean, default: false },
    footerNote: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const permissionSettingsSchema = new mongoose.Schema(
  {
    supervisorDept: { type: Boolean, default: false },
    hrAllDept: { type: Boolean, default: false },
    employeeDownload: { type: Boolean, default: false },
    historyMonths: { type: Number, default: 6, min: 0 },
  },
  { _id: false }
);

const notificationSettingsSchema = new mongoose.Schema(
  {
    autoSend: { type: Boolean, default: false },
    sendFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', ''],
      default: '',
    },
    recipients: {
      type: [String],
      default: [],
      set: (values) =>
        Array.isArray(values)
          ? values
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter(Boolean)
          : [],
    },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, default: 'custom', trim: true },
    fields: {
      type: [String],
      default: [],
      set: (values) =>
        Array.isArray(values)
          ? values
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter(Boolean)
          : [],
    },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    exportSettings: { type: exportSettingsSchema, default: () => ({}) },
    permissionSettings: { type: permissionSettingsSchema, default: () => ({}) },
    notificationSettings: { type: notificationSettingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export default mongoose.model('Report', reportSchema);
