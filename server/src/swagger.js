export default {
  openapi: '3.0.0',
  info: {
    title: 'HR System API',
    version: '1.0.0'
  },
  paths: {
    '/api/employees': {
      get: {
        summary: 'List employees',
        responses: {
          '200': {
            description: 'A list of employees',
            content: {
              'application/json': {
                example: [{
                  _id: '650000000000000000000000',
                  name: 'John Doe',
                  email: 'john@example.com',
                  role: 'employee'
                }]
              }
            }
          }
        }
      },
      post: {
        summary: 'Create employee',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                name: 'Jane Doe',
                email: 'jane@example.com',
                role: 'employee'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Created employee',
            content: {
              'application/json': {
                example: {
                  _id: '650000000000000000000001',
                  name: 'Jane Doe',
                  email: 'jane@example.com',
                  role: 'employee'
                }
              }
            }
          }
        }
      }
    },
    '/api/attendance': {
      get: {
        summary: 'List attendance records',
        responses: {
          '200': {
            description: 'A list of attendance records',
            content: {
              'application/json': {
                example: [{
                  _id: '660000000000000000000000',
                  employee: '650000000000000000000000',
                  action: 'clockIn',
                  timestamp: '2024-01-01T08:00:00Z'
                }]
              }
            }
          }
        }
      },
      post: {
        summary: 'Create attendance record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                employee: '650000000000000000000000',
                action: 'clockIn'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Created record',
            content: {
              'application/json': {
                example: {
                  _id: '660000000000000000000001',
                  employee: '650000000000000000000000',
                  action: 'clockIn',
                  timestamp: '2024-01-01T08:00:00Z'
                }
              }
            }
          }
        }
      }
    },
    '/api/leaves': {
      get: {
        summary: 'List leaves',
        responses: {
          '200': {
            description: 'A list of leave requests',
            content: {
              'application/json': {
                example: [{
                  _id: '670000000000000000000000',
                  employee: '650000000000000000000000',
                  startDate: '2024-02-01',
                  endDate: '2024-02-05',
                  type: 'vacation',
                  status: 'pending'
                }]
              }
            }
          }
        }
      },
      post: {
        summary: 'Create leave',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                employee: '650000000000000000000000',
                startDate: '2024-02-01',
                endDate: '2024-02-05',
                type: 'vacation'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Created leave',
            content: {
              'application/json': {
                example: {
                  _id: '670000000000000000000001',
                  employee: '650000000000000000000000',
                  startDate: '2024-02-01',
                  endDate: '2024-02-05',
                  type: 'vacation',
                  status: 'pending'
                }
              }
            }
          }
        }
      }
    },
    '/api/schedules': {
      get: {
        summary: 'List schedules',
        responses: {
          '200': {
            description: 'A list of schedules',
            content: {
              'application/json': {
                example: [{
                  _id: '680000000000000000000000',
                  employee: '650000000000000000000000',
                  date: '2024-03-01',
                  shift: 'morning'
                }]
              }
            }
          }
        }
      },
      post: {
        summary: 'Create schedule',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: {
                employee: '650000000000000000000000',
                date: '2024-03-01',
                shift: 'morning'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Created schedule',
            content: {
              'application/json': {
                example: {
                  _id: '680000000000000000000001',
                  employee: '650000000000000000000000',
                  date: '2024-03-01',
                  shift: 'morning'
                }
              }
            }
          }
        }
      }
    }
  }
};
