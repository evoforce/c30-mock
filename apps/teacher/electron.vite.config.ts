import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // ws 的可选原生加速模块,保持 external 让运行时从 node_modules 加载
        // (缺失时 ws 会静默降级为纯 JS 实现,不影响功能)
        external: ['bufferutil', 'utf-8-validate'],
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
