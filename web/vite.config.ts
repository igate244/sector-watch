import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages ではリポジトリ名の下に置かれる（https://<user>.github.io/sector-watch/）
const base = process.env.BASE_PATH ?? '/sector-watch/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'セクター観測',
        short_name: 'セクター観測',
        description: 'セクターごとに株価を追い、下げの原因を市場・セクター・個別に分ける',
        lang: 'ja',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#1a1a19',
        theme_color: '#1a1a19',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 画面の骨格は先にキャッシュ。計算結果（data/*.json）は毎回取りに行き、圏外なら前回分を出す
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        globIgnores: ['data/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'data', networkTimeoutSeconds: 8, expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
});
