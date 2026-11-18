import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
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
