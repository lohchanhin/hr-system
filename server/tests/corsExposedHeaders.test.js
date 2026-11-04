import request from 'supertest'

// 跨網域部署（前端與 API 不同網域）時，瀏覽器只讓前端讀到 CORS exposedHeaders 列出的回應標頭：
// 申請頁「只列出您部門開放的表單」的提示靠表單清單的 X-Form-Visibility（審查 F2），沒列出就永遠不會顯示。
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

let app
let FORM_VISIBILITY_HEADER

beforeAll(async () => {
  ;({ app } = await import('../src/index.js'))
  ;({ FORM_VISIBILITY_HEADER } = await import('../src/services/formVisibilityService.js'))
})

const exposedHeadersOf = (res) => String(res.headers['access-control-expose-headers'] || '').split(',').map(item => item.trim().toLowerCase())

describe('CORS exposed headers', () => {
  it('exposes the form visibility header (and keeps the list headers) to an allowed cross-origin front end', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    const exposed = exposedHeadersOf(res)
    expect(exposed).toContain(FORM_VISIBILITY_HEADER.toLowerCase())
    expect(exposed).toEqual(expect.arrayContaining(['x-approvals-truncated', 'x-total-count', 'x-page', 'x-limit']))
  })

  it('does not open the API to an origin that is not allowed', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.test')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
