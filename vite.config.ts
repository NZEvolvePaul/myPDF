/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'MyPDF',
        short_name: 'MyPDF',
        description: 'Read, sign and initial PDFs',
        theme_color: '#1f4e8c',
        background_color: '#f3f4f6',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        file_handlers: [{ action: '/', accept: { 'application/pdf': ['.pdf'] } }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,mjs}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'] },
});
