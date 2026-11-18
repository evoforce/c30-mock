// 启动 Electron dev 的包装脚本
// 解决:WorkBuddy 桌面环境全局设置 ELECTRON_RUN_AS_NODE=1,
// 导致 electron 子进程以纯 node 模式运行(require('electron') 返回路径字符串而非 API 对象)。
// 在 spawn 前从环境变量中删除该变量。
//
// 另外:直接 spawn electron-vite 的 JS 入口(不经过 shell / cmd.exe),
// 避免 Windows 下「shell: true + 参数数组」触发的 DEP0190 弃用告警,也少一层 cmd 转发。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// pnpm 执行包脚本时 cwd 就是包目录(apps/teacher、apps/student),
// electron-vite 一定装在该包的 node_modules 下。
const bin = join(process.cwd(), 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
if (!existsSync(bin)) {
  console.error(`[dev] electron-vite not found at ${bin} - run pnpm install first`);
  process.exit(1);
}

// 透传参数给 electron-vite(如 --remote-debugging-port=9333、--inspect 等);
// pnpm 会把分隔符 `--` 原样传进来,这里过滤掉,避免它被当成 electron 参数。
const passthrough = process.argv.slice(2).filter((a) => a !== '--');

const child = spawn(process.execPath, [bin, 'dev', ...passthrough], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
