import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
  build: {
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/service-worker/core/background.ts'),
        content: resolve(__dirname, 'src/isolated-world/content-script.ts'),
        pageBridge: resolve(__dirname, 'src/main-world/page-bridge.ts'),
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        dashboard: resolve(__dirname, 'src/ui/dashboard/index.html')
      },
      output: {
        entryFileNames: '[name].js',
      }
    }
  }
});
