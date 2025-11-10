import Department from '../models/Department.js';

export async function listDepartments(req, res) {
  try {
    const filter = {};
    if (req.query.organization) {
      filter.organization = req.query.organization;
    }
    const departments = await Department.find(filter);
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDepartment(req, res) {
  try {
    const {
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes
    } = req.body;
    const dept = new Department({
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes
    });
    await dept.save();
    res.status(201).json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateDepartment(req, res) {
  try {
    const {
      name,
      code,
      unitName,
      institutionCode,
      uniformNumber,
      laborInsuranceNumber,
      healthInsuranceNumber,
      taxRegistrationNumber,
      location,
      phone,
      responsiblePerson,
      manager,
      organization,
      defaultTwoDayOff,
      tempChangeAllowed,
      deptManager,
      scheduleNotes
    } = req.body;
    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      {
        name,
        code,
        unitName,
        institutionCode,
        uniformNumber,
        laborInsuranceNumber,
        healthInsuranceNumber,
        taxRegistrationNumber,
        location,
        phone,
        responsiblePerson,
        manager,
        organization,
        defaultTwoDayOff,
        tempChangeAllowed,
        deptManager,
        scheduleNotes
      },
      { new: true }
    );
    if (!dept) return res.status(404).json({ error: 'Not found' });
    res.json(dept);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteDepartment(req, res) {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
