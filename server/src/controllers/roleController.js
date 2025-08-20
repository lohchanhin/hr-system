export function listRoles(req, res) {
  const roles = [
    { id: 'employee', name: '員工' },
    { id: 'supervisor', name: '主管' },
    { id: 'admin', name: '管理員' }
  ]
  res.json(roles)
}
