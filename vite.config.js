import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_PUBLIC_BASE ?? '/',
    plugins: [react()],
    server: {
      proxy: {
        '/api': env.POPULATION_API_TARGET ?? 'http://127.0.0.1:8787',
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-echarts': ['echarts', 'echarts-for-react'],
          },
        },
      },
    },
  }
})
