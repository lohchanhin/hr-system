export function normalizeEmployeeIdentifier(value) {
  return String(value ?? '').trim().normalize('NFKC').toUpperCase();
}

export default {
  normalizeEmployeeIdentifier,
};
