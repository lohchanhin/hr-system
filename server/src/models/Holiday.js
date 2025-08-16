import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  description: String,
}, { timestamps: true });

export default mongoose.model('Holiday', holidaySchema);
