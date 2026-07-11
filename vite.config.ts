import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'prompt', includeAssets: [], manifest: { name: 'Remember Notes', short_name: 'Remember', description: 'Private hierarchical notes', theme_color: '#16202a', background_color: '#f5f2ea', display: 'standalone', start_url: './' }, workbox: { navigateFallback: 'index.html', runtimeCaching: [] } })],
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', coverage: { reporter: ['text', 'html'] } }
})
