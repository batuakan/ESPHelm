import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The editor is served by signalk-server as a webapp from signalk-esphelm/public at
// /signalk-esphelm/, so assets use relative URLs. `npm run dev` proxies the SignalK API.
const signalk = process.env.ESPHELM_SIGNALK ?? 'http://localhost:3000';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@esphelm/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../plugin/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/plugins': signalk,
      '/skServer': signalk,
      '/admin': signalk,
      '/signalk': { target: signalk, ws: true },
    },
  },
});
