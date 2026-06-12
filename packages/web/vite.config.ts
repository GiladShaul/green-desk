import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sentryDsn = process.env.VITE_SENTRY_DSN;

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: sentryDsn ? true : false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
