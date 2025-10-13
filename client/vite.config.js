import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 明確定義 fallback：dev 走 localhost:3000，prod 要有環境變數
  const API_BASE_URL =
    env.VITE_API_BASE_URL ||
    (mode === 'development'
      ? 'http://localhost:3000'
      : 'https://hr-system-d7fc5ea7aab1.herokuapp.com') // 確保 prod 不會是空字串

  const resolveSrc = () => {
    try {
      return fileURLToPath(new URL('./src', import.meta.url))
    } catch (error) {
      if (error?.code === 'ERR_INVALID_URL_SCHEME') {
        return path.resolve(process.cwd(), 'src')
      }
      throw error
    }
  }

  const config = {
    plugins: [vue(), vueDevTools()],
    resolve: {
      alias: {
        '@': resolveSrc(),
      },
    },
    define: {
      __API_BASE_URL__: JSON.stringify(API_BASE_URL), // 可選：讓前端也能直接引用
    },
    test: {
      environment: 'jsdom',
    },
  }

  if (mode === 'development') {
    config.server = {
      proxy: {
        '/api': {
          target: API_BASE_URL,
          changeOrigin: true,
        },
      },
    }
  }

  return config
})
