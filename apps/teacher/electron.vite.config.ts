import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // ws 的可选原生加速模块 + 全局鼠标钩子原生模块,保持 external 让运行时从 node_modules 加载
        external: ['bufferutil', 'utf-8-validate', 'uiohook-napi'],
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
