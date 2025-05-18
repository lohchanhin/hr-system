import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

export async function getAttendanceRecords () {
  const { data } = await apiClient.get('/attendance')
  return data
}

export async function createAttendanceRecord (record) {
  const { data } = await apiClient.post('/attendance', record)
  return data
}

export async function getLeaveRequests () {
  const { data } = await apiClient.get('/leaves')
  return data
}

export async function createLeaveRequest (record) {
  const { data } = await apiClient.post('/leaves', record)
  return data
}
