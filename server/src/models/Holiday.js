import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema({
  name: { type: String, default: '' },
  date: { type: Date, required: true },
  type: { type: String, default: '國定假日' },
  desc: String,
  description: String,
  source: String,
}, { timestamps: true });

export default mongoose.model('Holiday', holidaySchema);
