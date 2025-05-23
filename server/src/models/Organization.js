import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema({
  systemCode: String,
  orgCode: String,
  taxIdNumber: String,
  laborInsuranceNo: String,
  healthInsuranceNo: String,
  taxCode: String,
  address: String,
  phone: String,
  principal: String
}, { timestamps: true });

export default mongoose.model('Organization', organizationSchema);
