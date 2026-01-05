import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
function resolveSrcAlias() {
  try {
    const srcUrl = new URL('./src', import.meta.url)
    if (srcUrl.protocol === 'file:') {
      return fileURLToPath(srcUrl)
    }
  } catch (error) {
    // 在測試或非 file protocol 環境下 fallback 至相對路徑
  }
  return './src'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 明確定義 fallback：dev 走 localhost:3000，prod 使用相對路徑（與前端同源）
  const API_BASE_URL =
    env.VITE_API_BASE_URL ||
    (mode === 'development'
      ? 'http://localhost:3000'
      : '') // 生產環境使用相對路徑，部署時可透過 VITE_API_BASE_URL 環境變數指定

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
