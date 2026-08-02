export default function privateUploadGuard(req, res, next) {
  const requestPath = req.path || ''
  const isApprovalAttachment = requestPath.startsWith('/approvals/')
  const isPrivateEmployeePhoto = requestPath.startsWith('/employees/')
  const isLegacyEmployeePhoto = /^\/employee_[^/]+$/.test(requestPath)

  if (isApprovalAttachment || isPrivateEmployeePhoto || isLegacyEmployeePhoto) {
    return res.status(404).json({ error: 'Not found' })
  }
  next()
}
