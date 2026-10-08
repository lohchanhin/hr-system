import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ApprovalDetailContent from '../src/views/front/ApprovalDetailContent.vue'

const { messageError } = vi.hoisted(() => ({ messageError: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: Object.assign(vi.fn(), { error: messageError }) }
})

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  messageError.mockReset()
})

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  blob: () => Promise.resolve(new Blob(['x'])),
})

const buildDoc = (overrides = {}) => ({
  _id: 'a1',
  status: 'returned',
  form: {
    name: '請假',
    category: '人事',
    semanticType: 'leave',
    fields: [
      { _id: 'f1', label: '開始時間', type_1: 'datetime' },
      { _id: 'f2', label: '假別', type_1: 'select', options: [{ label: '病假', value: 'sick' }] },
      { _id: 'f3', label: '代理人', type_1: 'user' },
      { _id: 'f4', label: '事由', type_1: 'text' },
      { _id: 'f5', label: '附件', type_1: 'file' },
      { _id: 'f6', label: '類別', type_1: 'checkbox', options: ['甲'] },
    ],
  },
  form_data: {
    f1: '2026-06-19T01:00:00.000Z',
    f2: 'sick',
    f3: 'u1',
    f4: '',
    f5: [{ name: 'proof.pdf', url: '/upload/approvals/x.pdf' }],
    f6: [],
    removed_field: '舊欄位的內容',
  },
  applicant_employee: { name: 'Bob' },
  current_step_index: 0,
  steps: [
    {
      all_must_approve: true,
      is_required: true,
      approvers: [{ approver: { _id: 'u2', name: 'Alice' }, decision: 'returned', decided_at: '2026-06-19T02:00:00.000Z' }],
    },
  ],
  logs: [
    { action: 'create', by_employee: 'app1', at: '2026-06-19T00:00:00.000Z', message: '建立送審單' },
    { action: 'return', by_employee: { _id: 'u2', name: 'Alice' }, at: '2026-06-19T02:00:00.000Z', message: '請補充說明' },
  ],
  ...overrides,
})

const mountContent = (approvalId) => mount(ApprovalDetailContent, {
  props: { approvalId },
  global: { plugins: [ElementPlus] },
})

describe('ApprovalDetailContent 載入與顯示', () => {
  it('以台灣時間與可讀文字顯示欄位內容，而不是原始 ISO、編號與空字串', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/employees/options')) {
        return Promise.resolve(jsonResponse([{ _id: 'u1', name: '王小明' }]))
      }
      return Promise.resolve(jsonResponse(buildDoc()))
    })
    const wrapper = mountContent('a1')
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('2026/06/19 09:00')
    expect(text).not.toContain('2026-06-19T01:00:00.000Z')
    expect(text).toContain('病假')
    expect(text).toContain('王小明')
    expect(text).not.toContain('u1')
    // 空字串與空陣列顯示 -
    const rows = wrapper.findAll('.el-descriptions__table tr').map(tr => tr.text())
    expect(rows.find(row => row.startsWith('事由'))).toMatch(/事由\s*-/)
    expect(rows.find(row => row.startsWith('類別'))).toMatch(/類別\s*-/)
    // 欄位已被刪除、但申請單裡還有的資料仍然列出
    expect(text).toContain('舊欄位的內容')
    // 流程時間同樣用台灣時間
    expect(text).toContain('2026/06/19 10:00')
  })

  it('被退簽時顯示退簽原因與簽核紀錄', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(buildDoc()))
    const wrapper = mountContent('a1')
    await flushPromises()

    expect(wrapper.find('.return-reason-alert').text()).toContain('請補充說明')
    expect(wrapper.find('.return-reason-alert').text()).toContain('Alice')
    const logText = wrapper.find('.detail-logs').text()
    expect(logText).toContain('退簽')
    expect(logText).toContain('送出申請')
  })

  it('載入失敗時顯示伺服器的中文原因', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: 'not found' }, 404))
    const wrapper = mountContent('a1')
    await flushPromises()
    expect(wrapper.find('.detail-error').text()).toContain('取得審批明細失敗')
    expect(wrapper.find('.detail-error').text()).not.toMatch(/not found/i)
    expect(wrapper.vm.loading).toBe(false)
  })

  it('網路中斷時顯示通用中文訊息並關閉載入中', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = mountContent('a1')
    await flushPromises()
    expect(wrapper.find('.detail-error').text()).toContain('網路連線異常')
    expect(wrapper.vm.loading).toBe(false)
  })

  it('沒有 approvalId 時不發出請求', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({}))
    const wrapper = mountContent('')
    await flushPromises()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(wrapper.vm.loading).toBe(false)
  })
})

describe('ApprovalDetailContent 快速切換申請單', () => {
  function deferredFetch({ honorAbort = true } = {}) {
    const pending = {}
    vi.spyOn(window, 'fetch').mockImplementation((url, options = {}) => new Promise((resolve, reject) => {
      const id = String(url).split('/api/approvals/')[1]
      pending[id] = { resolve, signal: options.signal }
      if (honorAbort) {
        options.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }
    }))
    return pending
  }

  it('切換時取消前一個請求，被取消的請求收尾不會把後一個請求的載入中關掉', async () => {
    const pending = deferredFetch()
    const wrapper = mountContent('a1')
    await flushPromises()
    expect(wrapper.vm.loading).toBe(true)

    await wrapper.setProps({ approvalId: 'a2' })
    await flushPromises()
    expect(pending.a1.signal.aborted).toBe(true)
    // 第二個請求還在跑：載入中必須維持
    expect(wrapper.vm.loading).toBe(true)

    // 再切到第三個：第二個請求必須還能被取消（舊程式的 finally 會把 controller 清掉而取消不到）
    await wrapper.setProps({ approvalId: 'a3' })
    await flushPromises()
    expect(pending.a2.signal.aborted).toBe(true)
    expect(wrapper.vm.loading).toBe(true)

    pending.a3.resolve(jsonResponse(buildDoc({ _id: 'a3', applicant_employee: { name: '第三張' } })))
    await flushPromises()
    expect(wrapper.vm.loading).toBe(false)
    expect(wrapper.text()).toContain('第三張')
  })

  it('晚到的舊回應不會蓋掉目前的內容', async () => {
    const pending = deferredFetch({ honorAbort: false })
    const wrapper = mountContent('a1')
    await flushPromises()
    await wrapper.setProps({ approvalId: 'a2' })
    await flushPromises()

    pending.a2.resolve(jsonResponse(buildDoc({ _id: 'a2', applicant_employee: { name: '新的申請人' } })))
    await flushPromises()
    expect(wrapper.text()).toContain('新的申請人')

    pending.a1.resolve(jsonResponse(buildDoc({ _id: 'a1', applicant_employee: { name: '舊的申請人' } })))
    await flushPromises()
    expect(wrapper.text()).toContain('新的申請人')
    expect(wrapper.text()).not.toContain('舊的申請人')
    expect(wrapper.vm.loading).toBe(false)
  })

  it('元件卸載時取消進行中的請求', async () => {
    const pending = deferredFetch()
    const wrapper = mountContent('a1')
    await flushPromises()
    wrapper.unmount()
    expect(pending.a1.signal.aborted).toBe(true)
  })
})

describe('ApprovalDetailContent 附件下載', () => {
  function stubDownloadApis() {
    const created = []
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
      created.push({ download: this.download, href: this.href })
    })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    return { created, click, open, createObjectURL }
  }

  it('以 <a download> 保留原檔名下載，不再用 window.open 開空白的 blob', async () => {
    const { created, open, createObjectURL } = stubDownloadApis()
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/attachments/')) return Promise.resolve(jsonResponse({}))
      return Promise.resolve(jsonResponse(buildDoc()))
    })
    const wrapper = mountContent('a1')
    await flushPromises()

    const link = wrapper.findAll('.attachment-list a')[0]
    expect(link.text()).toContain('proof.pdf')
    await link.trigger('click')
    await flushPromises()

    const downloadCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/attachments/'))
    expect(downloadCall[0]).toContain('/api/approvals/a1/attachments/x.pdf')
    expect(createObjectURL).toHaveBeenCalled()
    expect(created).toEqual([expect.objectContaining({ download: 'proof.pdf' })])
    expect(open).not.toHaveBeenCalled()
    expect(messageError).not.toHaveBeenCalled()
  })

  it('下載失敗時提示中文訊息', async () => {
    stubDownloadApis()
    vi.spyOn(window, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/attachments/')) return Promise.resolve(jsonResponse({ error: 'Forbidden' }, 403))
      return Promise.resolve(jsonResponse(buildDoc()))
    })
    const wrapper = mountContent('a1')
    await flushPromises()
    await wrapper.findAll('.attachment-list a')[0].trigger('click')
    await flushPromises()

    expect(messageError).toHaveBeenCalledTimes(1)
    expect(messageError.mock.calls[0][0]).toContain('附件下載失敗')
    expect(messageError.mock.calls[0][0]).toContain('沒有權限')
  })
})
