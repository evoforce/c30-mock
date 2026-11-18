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
    server: {
      watch: {
        // 忽略编辑器/工具「原子写」留下的临时目录(<file>.<pid>.<uuid>.tmpdir)。
        // 这类目录被 vite 的文件监听碰到时,Windows 上会抛 EBUSY 并让整个 dev 进程退出。
        ignored: ['**/*.tmpdir', '**/*.tmpdir/**'],
      },
    },
  },
});
