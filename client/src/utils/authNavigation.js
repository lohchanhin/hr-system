const HOME_ROUTES = Object.freeze({
  employee: '/front/attendance',
  supervisor: '/front/schedule',
  admin: '/manager/settings'
})

export function getAuthenticatedHomeRoute(role) {
  return HOME_ROUTES[role] || null
}

