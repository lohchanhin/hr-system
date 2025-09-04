import Employee from '../src/models/Employee.js';

describe('Employee model validation', () => {
  it('should require email', () => {
    const emp = new Employee({ name: 'NoEmail' });
    const err = emp.validateSync();
    expect(err.errors.email.kind).toBe('required');
  });
});
