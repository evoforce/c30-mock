#!/usr/bin/env node
// 原生鼠标钩子(uiohook-napi)自检 —— 防止「加载到旧产物 → 按下鼠标后光标卡死」再次发生。
//
// 背景(踩过三次):
//   我们用 pnpm patch 给 uiohook-napi 增加了 setMouseConsume(),用来在「画笔/板擦」批注时
//   吞掉桌面的 mousedown(避免误框选)。这套能力是「补丁源码 + 手工编译的 .node」两级产物:
//     · patches/uiohook-napi.patch   ← 源码补丁(跟着 git 走)
//     · build/Release/*.node         ← 手工用 Node20 + VS2017 编译(不进 git)
//   任何一级落后于另一级,或 node_modules 被重装/回滚,就可能加载到「吞 DRAGGED」的旧产物,
//   表现就是:画笔/板擦一按下鼠标,光标就动不了(页面全部卡死)。
//
// 本脚本做三件事:
//   1. 检查 build/Release 产物是否存在(不存在时会回退到 prebuilds 官方包,没有吞事件能力);
//   2. 用当前 Node 加载该模块,读取 getConsumeMode();
//   3. 期望值为 2(只吞 PRESSED)。不是 2 就打印明确的修复步骤。
//
// 输出约定:本脚本在 dev/CI 的终端里跑,日志一律用 ASCII 英文。
// (Windows 中文控制台是 GBK/936,UTF-8 中文输出会变成乱码;ASCII 在任何代码页下都正常。)
//
// 用法:
//   node scripts/verify-uiohook.mjs           # 检查,不符合时只告警(不阻断 dev)
//   node scripts/verify-uiohook.mjs --strict  # 不符合时以非 0 退出(给 CI 用)

import { createRequire } from 'node:module';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const STRICT = process.argv.includes('--strict');
const EXPECTED_MODE = 2;
const EXPECTED_NODE_MAJOR = '20'; // Electron 33 内嵌 Node 20.18;用 Node20 头文件编译

function fail(lines) {
  console.error('');
  console.error('  [FAIL] uiohook native module self-check failed');
  for (const l of lines) console.error(`         ${l}`);
  console.error('');
  console.error('  How to fix (either one):');
  console.error('    1) pnpm install          # re-apply patches/uiohook-napi.patch');
  console.error('    2) pnpm rebuild:uiohook  # rebuild native module (Node 20 + VS2017)');
  console.error('');
  process.exit(STRICT ? 1 : 0);
}

function ok(msg) {
  console.log(`  [ok] ${msg}`);
}

// 本地时间、纯 ASCII 格式(避免依赖 locale;也避免 UTC 与本机时间对不上)
function fmtLocalTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 1) 定位模块(teacher 的软链指向带 patch_hash 的 .pnpm 目录)
const teacherLink = join(ROOT, 'apps', 'teacher', 'node_modules', 'uiohook-napi');
if (!existsSync(teacherLink)) {
  fail([`apps/teacher/node_modules/uiohook-napi not found; run pnpm install first`]);
}

// realpathSync 把 pnpm 的目录软链/junction 解开,拿到 .pnpm/..._patch_hash=... 的真实目录
let moduleDir;
try {
  moduleDir = realpathSync(teacherLink);
} catch {
  moduleDir = resolve(teacherLink);
}

// 2) 检查 build/Release 产物
const releaseDir = join(moduleDir, 'build', 'Release');
const releaseBins = existsSync(releaseDir)
  ? readdirSync(releaseDir).filter((f) => f.endsWith('.node'))
  : [];

if (releaseBins.length === 0) {
  fail([
    `no hand-built artifact found: ${releaseDir}`,
    'node-gyp-build will fall back to the official prebuild (no setMouseConsume / getConsumeMode),',
    'so "block desktop rubber-band selection" is disabled (no freeze, but the desktop may be selected by mistake).',
  ]);
}

const bin = join(releaseDir, releaseBins[0]);
const binStat = statSync(bin);
ok(`artifact: ${releaseBins[0]} (${binStat.size} bytes, ${fmtLocalTime(binStat.mtime)})`);

// 3) 版本校验:仅当用 Node20 加载才安全(用 Node22 加载会因 NAPI/threadsafe function 崩溃)
if (!process.versions.node.startsWith(`${EXPECTED_NODE_MAJOR}.`)) {
  console.log(
    `  [warn] current Node ${process.versions.node} is not ${EXPECTED_NODE_MAJOR}.x; ` +
      'artifact load-check skipped (run with Node 20 to verify consume-mode).',
  );
  process.exit(0);
}

// 4) 读取 consume-mode
const require = createRequire(import.meta.url);
let mode;
try {
  const mod = require(join(moduleDir, 'dist', 'index.js'));
  const hook = mod.uIOhook;
  if (typeof hook.setMouseConsume !== 'function') {
    fail(['native module has no setMouseConsume(): the official prebuild (unpatched) is loaded.']);
  }
  if (typeof hook.getConsumeMode !== 'function') {
    fail(['native module has no getConsumeMode(): old patched build (cannot self-check, treated as unsafe).']);
  }
  mode = Number(hook.getConsumeMode());
} catch (err) {
  fail([`failed to load native module: ${err?.message ?? err}`]);
}

if (mode !== EXPECTED_MODE) {
  fail([
    `consume-mode = ${mode}, expected ${EXPECTED_MODE}.`,
    mode === 1
      ? 'This is the old build that swallows DRAGGED/RELEASED - the cursor freezes once you press the pen/eraser!'
      : 'Unknown version; cannot confirm the "swallow PRESSED only" semantics.',
  ]);
}

ok(`consume-mode = ${mode} (PRESSED only; move/drag/release pass through)`);
console.log('  [ok] uiohook native module self-check passed');
