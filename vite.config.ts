import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // 读取 VITE_API_BASE（真实后端网关基址，可配置）
  const env = loadEnv(mode, process.cwd(), ['VITE_'])
  const apiBase = (env.VITE_API_BASE ?? process.env.VITE_API_BASE ?? '').replace(/\/$/, '')

  // 开发环境：浏览器同源打 /startlandapi，由 Vite 转发到真实后端，规避 CORS
  const proxy: Record<string, { target: string; changeOrigin: boolean }> = {}
  if (apiBase) {
    proxy['/startlandapi'] = { target: apiBase, changeOrigin: true }
  }
  // 文件服务（APK 上传/下载）独立 REST 服务，开发环境同样由 Vite 反代到 VITE_FILE_API_BASE 规避 CORS
  const fileApiBase = (env.VITE_FILE_API_BASE ?? '').replace(/\/$/, '')
  if (fileApiBase) {
    proxy['/api/v1'] = { target: fileApiBase, changeOrigin: true }
  }

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      host: true,
      proxy,
    },
  }
})
