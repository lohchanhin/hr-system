import InsuranceRecord from '../models/InsuranceRecord.js';

export async function listInsurance(req, res) {
  const records = await InsuranceRecord.find().populate('employee');
  res.json(records);
}

export async function createInsurance(req, res) {
  try {
    const record = new InsuranceRecord(req.body);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getInsurance(req, res) {
  try {
    const record = await InsuranceRecord.findById(req.params.id).populate('employee');
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateInsurance(req, res) {
  try {
    const record = await InsuranceRecord.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteInsurance(req, res) {
  try {
    const record = await InsuranceRecord.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
