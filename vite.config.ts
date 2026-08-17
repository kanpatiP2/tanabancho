import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));

/** legacy/（現行v1一式）をビルド成果物の /v1/ として同梱する */
function copyLegacyPlugin() {
  return {
    name: 'copy-legacy-v1',
    closeBundle() {
      cpSync(join(root, 'legacy'), join(root, 'dist', 'v1'), { recursive: true });
    },
  };
}

export default defineConfig({
  // GitHub Pages のプロジェクトサイト（kanpatip2.github.io/tanabancho/）
  base: '/tanabancho/',
  // 旧リポジトリの public/ は旧・汎用版のソースだったため、静的アセットは static/ に置く
  publicDir: 'static',
  plugins: [
    preact(),
    copyLegacyPlugin(),
    VitePWA({
      registerType: 'prompt',
      // MPA なので SPA 向けフォールバックは使わない（/v1/ や share.html を奪わない）
      workbox: {
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // v1（旧版）は SW 管理外
        globIgnores: ['v1/**'],
      },
      manifest: {
        name: '棚番長',
        short_name: '棚番長',
        description: '売場スキャン・棚番管理ツール',
        lang: 'ja',
        start_url: '/tanabancho/',
        scope: '/tanabancho/',
        display: 'standalone',
        background_color: '#1c1b1a',
        theme_color: '#0f766e',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@core': resolve(root, 'src/core'),
      '@scanner': resolve(root, 'src/scanner'),
      '@lookup': resolve(root, 'src/lookup'),
      '@order-export': resolve(root, 'src/order-export'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        share: resolve(root, 'share.html'),
        shiwake: resolve(root, 'shiwake/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
