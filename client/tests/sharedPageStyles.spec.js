import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'fs'
import path from 'path'
import PageHeader from '../src/components/PageHeader.vue'

const SRC = path.resolve(__dirname, '../src')
const read = file => fs.readFileSync(path.resolve(SRC, file), 'utf-8')

// src 底下所有畫面與樣式檔（不含測試）
function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.(vue|scss|css)$/.test(entry.name) ? [full] : []
  })
}

describe('共用頁首 PageHeader 的選項', () => {
  it('預設沒有任何修飾 class', () => {
    const wrapper = mount(PageHeader, { props: { title: '出勤設定' } })
    expect(wrapper.find('[data-test="page-header"]').classes()).toEqual(['hr-page-header'])
  })

  it('compact、stats-below、sticky 各自加上共用樣式的 class', () => {
    const wrapper = mount(PageHeader, {
      props: { title: '薪資管理', compact: true, statsBelow: true, sticky: true },
      slots: { stats: '<span class="hr-stat">人數 3</span>', actions: '<button>儲存</button>' }
    })
    const classes = wrapper.find('[data-test="page-header"]').classes()
    expect(classes).toContain('hr-page-header--compact')
    expect(classes).toContain('hr-page-header--stats-below')
    expect(classes).toContain('hr-sticky-bar')
    expect(wrapper.find('.hr-page-header__stats').text()).toBe('人數 3')
    expect(wrapper.find('.hr-page-header__actions').text()).toBe('儲存')
  })
})

describe('共用樣式 page.css 與外框', () => {
  const pageCss = read('assets/page.css')

  it('頁首選項、固定列與對話框的手機寬度都定義在 page.css', () => {
    expect(pageCss).toMatch(/\.hr-page-header--compact \.hr-page-header__text\s*{[^}]*flex-basis:\s*110px/)
    expect(pageCss).toMatch(/\.hr-page-header--stats-below \.hr-page-header__stats\s*{[^}]*flex:\s*1 1 100%/)
    // 固定列的位置由外框的留白變數決定，不寫死 -24px／-12px
    expect(pageCss).toMatch(/\.hr-sticky-bar\s*{[^}]*position:\s*sticky;[^}]*top:\s*calc\(-1 \* var\(--hr-shell-padding, 0px\)\)/)
    expect(pageCss).toMatch(/\.el-dialog:not\(\.is-fullscreen\)\s*{[^}]*max-width:\s*calc\(100vw - 24px\)/)
  })

  it('後台與前台外框都設定內容區留白 --hr-shell-padding（桌機 24px、手機 12px），並用它當 padding', () => {
    for (const [file, desktop, mobile] of [
      ['views/ModernLayout.vue', /\.main-content\s*{[^}]*--hr-shell-padding:\s*24px;[^}]*padding:\s*var\(--hr-shell-padding\)/, /\.modern-layout\.is-mobile \.main-content\s*{[^}]*--hr-shell-padding:\s*12px/],
      ['views/front/FrontLayout.vue', /\.content-wrapper\s*{[^}]*--hr-shell-padding:\s*24px;[^}]*padding:\s*var\(--hr-shell-padding\)/, /\.front-layout\.is-mobile \.content-wrapper\s*{[^}]*--hr-shell-padding:\s*12px/]
    ]) {
      const source = read(file)
      expect(source, file).toMatch(desktop)
      expect(source, file).toMatch(mobile)
    }
  })

  // 八個畫面各自改頁首、各自算固定位置與手機的對話框寬度：收進共用選項後，各頁不要再寫一次
  it('各頁不再用 :deep() 改共用頁首的內部、不自己寫固定列的位置或對話框的手機寬度', () => {
    const offenders = []
    for (const file of sourceFiles()) {
      const name = path.relative(SRC, file).replace(/\\/g, '/')
      if (name === 'assets/page.css') continue
      const source = fs.readFileSync(file, 'utf-8')
      if (/:deep\(\.hr-page-header__/.test(source)) offenders.push(`${name}: :deep(.hr-page-header__…)`)
      if (/<el-dialog[^>]*width="min\(/.test(source) || /min\(\$\{px\}px, calc\(100vw/.test(source)) offenders.push(`${name}: 對話框寬度 min(…)`)
      if (/top:\s*-(24|12)px/.test(source)) offenders.push(`${name}: 寫死的固定列位置`)
    }
    expect(offenders).toEqual([])
  })

  it('目前頁面的導覽標示：兩個外框的側欄都是白色標記，前台底部分頁列用系統主色（不再是綠色）', () => {
    const modern = read('views/ModernLayout.vue')
    const front = read('views/front/FrontLayout.vue')
    const marker = /\.menu-item\.is-active::before\s*{[^}]*background:\s*var\(--hr-white\)/
    expect(modern).toMatch(marker)
    expect(front).toMatch(marker)
    expect(front).toMatch(/\.tab\.is-active\s*{[^}]*color:\s*var\(--el-color-primary\)/)
    expect(front).toMatch(/\.front-more-item\.is-active\s*{[^}]*color:\s*var\(--el-color-primary\)/)
    expect(modern + front).not.toMatch(/--hr-secondary/)
  })
})
