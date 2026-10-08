// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import 'element-plus/dist/index.css'
import './assets/main.css'
import './assets/responsive.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
// 日期選擇器、分頁、空資料等元件文字一律使用繁體中文
app.use(ElementPlus, { locale: zhTw })
app.mount('#app')
