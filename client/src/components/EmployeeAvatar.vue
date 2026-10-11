<!-- src/components/EmployeeAvatar.vue -->
<!--
  員工頭像：有照片就顯示照片，沒有（或沒有權限看）就顯示姓名第一個字。
  傳入伺服器回傳的員工物件即可：{ _id | id, name, photo | hasPhoto }；
  或是分開傳 employee-id（員工的 _id，不是員工編號）、name、photo / has-photo。
  - 照片是私有檔案，透過 utils/photoUrl 的快取以登入身分下載，同一位員工全站只下載一次
  - 只下載縮圖：邊長是頭像大小的 2 倍（取固定檔位），不同大小的頭像常常共用同一份縮圖，不必抓幾 MB 的原檔
  - 預設等頭像捲進畫面才開始下載（瀏覽器支援 IntersectionObserver 時），長清單不會一次打出整頁請求；
    沒有照片的頭像不需要監看，長清單裡沒有照片的人不會各建一個 observer
  - 編輯員工照片後，所有正在顯示該員工的頭像會自動換成新照片
-->
<template>
  <el-avatar
    ref="rootRef"
    class="employee-avatar-shared"
    role="img"
    :aria-label="label"
    :size="size"
    :shape="shape"
    :src="imageUrl"
    :alt="label"
    :style="avatarStyle"
    @error="handleImageError"
  >
    {{ initial }}
  </el-avatar>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  acquireCachedEmployeePhoto,
  acquireEmployeePhoto,
  photoSizeForDisplay,
  subscribeEmployeePhoto,
} from '../utils/photoUrl'

const props = defineProps({
  // 伺服器回傳的員工物件：用到 _id / id、name、photo、hasPhoto
  employee: { type: Object, default: null },
  // 員工的 _id（不是員工編號）；有傳就優先於 employee
  employeeId: { type: [String, Number], default: '' },
  name: { type: String, default: '' },
  // 照片路徑；沒有路徑只知道「有沒有照片」時傳 has-photo
  photo: { type: String, default: undefined },
  hasPhoto: { type: Boolean, default: undefined },
  size: { type: [Number, String], default: 32 },
  shape: { type: String, default: 'circle' },
  // 捲進畫面才開始下載照片
  lazy: { type: Boolean, default: true },
})

// 沒有照片時的底色：由員工 id（沒有就用姓名）決定，同一個人在每個畫面都是同一種顏色
const FALLBACK_COLORS = ['#0e7490', '#0f766e', '#4d7c0f', '#b45309', '#be123c', '#6d28d9', '#1d4ed8', '#475569']

const rootRef = ref(null)
const imageUrl = ref('')
const visible = ref(!props.lazy || typeof IntersectionObserver === 'undefined')

let lease = null
let generation = 0
let unmounted = false
let mountedOnce = false
let observer = null
let unsubscribe = null

const resolvedId = computed(() => {
  const id = props.employeeId || props.employee?._id || props.employee?.id
  return id == null ? '' : String(id)
})

const resolvedName = computed(() => {
  const value = props.name || props.employee?.name
  return typeof value === 'string' ? value.trim() : ''
})

const photoPath = computed(() => {
  const value = props.photo !== undefined ? props.photo : props.employee?.photo
  return typeof value === 'string' ? value.trim() : ''
})

const wantsPhoto = computed(() => {
  const flag = props.hasPhoto !== undefined ? props.hasPhoto : props.employee?.hasPhoto
  if (flag === false) return false
  return Boolean(photoPath.value) || flag === true
})

// 向伺服器要的縮圖邊長：頭像大小的 2 倍（高解析螢幕）取固定檔位，所以 32px 與 40px 的頭像共用同一份 96px 的縮圖
const photoSize = computed(() => photoSizeForDisplay(props.size))

const initial = computed(() => Array.from(resolvedName.value)[0] || '?')
const label = computed(() => (resolvedName.value ? `${resolvedName.value}的頭像` : '員工頭像'))

const avatarStyle = computed(() => {
  const seed = resolvedId.value || resolvedName.value
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  const pixels = Number(props.size)
  return {
    '--el-avatar-bg-color': FALLBACK_COLORS[hash % FALLBACK_COLORS.length],
    '--el-avatar-text-color': '#ffffff',
    ...(pixels > 0 ? { '--el-avatar-text-size': `${Math.max(11, Math.round(pixels * 0.42))}px` } : {}),
  }
})

function setLease(next) {
  const previous = lease
  lease = next && next.url ? next : null
  imageUrl.value = lease ? lease.url : ''
  if (next && !next.url) next.release()
  if (previous && previous !== lease) previous.release()
}

async function load() {
  const current = ++generation
  if (unmounted) return
  if (!wantsPhoto.value || !resolvedId.value) {
    setLease(null)
    return
  }
  const cached = acquireCachedEmployeePhoto(resolvedId.value, photoPath.value, photoSize.value)
  if (cached) {
    setLease(cached)
    return
  }
  try {
    const next = await acquireEmployeePhoto(resolvedId.value, photoPath.value, photoSize.value)
    if (current !== generation || unmounted) {
      next.release()
      return
    }
    setLease(next)
  } catch {
    // 下載失敗就維持字母頭像
    if (current === generation) setLease(null)
  }
}

function handleImageError() {
  // 圖片無法顯示（檔案損毀 / 網址已被回收）：改回字母頭像
  setLease(null)
}

function stopObserving() {
  observer?.disconnect()
  observer = null
}

function startObserving() {
  const target = rootRef.value?.$el ?? rootRef.value
  if (!target || typeof target.nodeType !== 'number') {
    visible.value = true
    void load()
    return
  }
  observer = new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      stopObserving()
      visible.value = true
      void load()
    },
    { rootMargin: '160px' },
  )
  observer.observe(target)
}

// 已經載入過的照片在第一次 render 就直接顯示，不先閃一下字母
if (wantsPhoto.value && resolvedId.value) {
  const cached = acquireCachedEmployeePhoto(resolvedId.value, photoPath.value, photoSize.value)
  if (cached) setLease(cached)
}

watch(
  resolvedId,
  id => {
    unsubscribe?.()
    unsubscribe = id
      ? subscribeEmployeePhoto(id, () => {
          if (visible.value) void load()
        })
      : null
  },
  { immediate: true },
)

watch([resolvedId, photoPath, wantsPhoto, photoSize], () => {
  if (visible.value) void load()
  // 原本沒有照片所以沒在監看，後來才有照片：這時才開始等捲進畫面
  else if (mountedOnce && wantsPhoto.value && !observer) startObserving()
})

onMounted(() => {
  mountedOnce = true
  if (visible.value) void load()
  // 沒有照片的頭像不必監看
  else if (wantsPhoto.value) startObserving()
})

onBeforeUnmount(() => {
  unmounted = true
  generation += 1
  stopObserving()
  unsubscribe?.()
  unsubscribe = null
  setLease(null)
})
</script>

<style scoped>
/* 放在 flex 的儲存格（頭像 + 姓名）裡不被擠扁 */
.employee-avatar-shared {
  flex: 0 0 auto;
}
</style>
