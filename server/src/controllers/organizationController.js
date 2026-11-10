import Organization from '../models/Organization.js';
import {
  IN_USE_CODE,
  notFoundBody,
  respondOrgError,
  inUseMessage,
  isInUse,
  isObjectIdText,
  organizationUsage,
} from '../services/orgStructureService.js';

export async function listOrganizations(req, res) {
  try {
    const organizations = await Organization.find();
    res.json(organizations);
  } catch (err) {
    respondOrgError(res, err, '機構', '讀取');
  }
}

export async function createOrganization(req, res) {
  try {
    const org = new Organization(req.body);
    await org.save();
    res.status(201).json(org);
  } catch (err) {
    respondOrgError(res, err, '機構');
  }
}

export async function updateOrganization(req, res) {
  try {
    // runValidators：修改時和新增一樣檢查必填與格式（以前把名稱清空也存得進去）；沒送的欄位不檢查也不動
    const org = await Organization.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!org) return res.status(404).json(notFoundBody('機構'));
    res.json(org);
  } catch (err) {
    respondOrgError(res, err, '機構');
  }
}

export async function deleteOrganization(req, res) {
  try {
    // 底下還有部門或員工時不刪除：不然部門與員工會留著一個不存在的機構
    if (isObjectIdText(req.params.id)) {
      const usage = await organizationUsage(req.params.id);
      if (isInUse(usage)) {
        const current = await Organization.findById(req.params.id).select('name').lean();
        if (!current) return res.status(404).json(notFoundBody('機構'));
        return res.status(409).json({ error: inUseMessage('機構', current.name, usage), code: IN_USE_CODE, usage });
      }
    }
    const org = await Organization.findByIdAndDelete(req.params.id);
    if (!org) return res.status(404).json(notFoundBody('機構'));
    res.json({ success: true });
  } catch (err) {
    respondOrgError(res, err, '機構');
  }
}
