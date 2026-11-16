import mongoose from 'mongoose';

const insuranceRateTableSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['laborInsurance', 'healthInsurance', 'laborPension'],
    required: true,
  },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  rates: { type: [mongoose.Schema.Types.Mixed], default: [] },
  source: { type: String, default: 'builtin-baseline' },
  sourceUrl: { type: String, default: '' },
}, { timestamps: true });

insuranceRateTableSchema.index({ type: 1, effectiveFrom: -1 });

export default mongoose.model('InsuranceRateTable', insuranceRateTableSchema);
