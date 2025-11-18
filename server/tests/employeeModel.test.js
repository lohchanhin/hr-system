import Employee from '../src/models/Employee.js';

describe('Employee model validation', () => {
  it('should require email', () => {
    const emp = new Employee({ name: 'NoEmail' });
    const err = emp.validateSync();
    expect(err.errors.email.kind).toBe('required');
  });

  it('sets and verifies password hash via helper', () => {
    const emp = new Employee({ name: 'Pwd', email: 'pwd@example.com', password: 'OldPass123' })
    expect(emp.passwordHash).toBeDefined()
    expect(emp.verifyPassword('OldPass123')).toBe(true)
    emp.setPassword('NewPass123')
    expect(emp.verifyPassword('OldPass123')).toBe(false)
    expect(emp.verifyPassword('NewPass123')).toBe(true)
  })
});
