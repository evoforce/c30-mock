// 启动 Electron dev 的包装脚本
// 解决:WorkBuddy 桌面环境全局设置 ELECTRON_RUN_AS_NODE=1,
// 导致 electron 子进程以纯 node 模式运行(require('electron') 返回路径字符串而非 API 对象)。
// 在 spawn 前从环境变量中删除该变量。
import { spawn } from 'node:child_process';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn('electron-vite', ['dev'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
