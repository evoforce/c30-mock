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
// 用法:
//   node scripts/verify-uiohook.mjs           # 检查,不符合时只告警(不阻断 dev)
//   node scripts/verify-uiohook.mjs --strict  # 不符合时以非 0 退出(给 CI 用)

import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const STRICT = process.argv.includes('--strict');
const EXPECTED_MODE = 2;
const EXPECTED_NODE_MAJOR = '20'; // Electron 33 内嵌 Node 20.18;用 Node20 头文件编译

function fail(lines) {
  console.error('');
  console.error('  ❌ 原生鼠标钩子自检未通过');
  for (const l of lines) console.error(`     ${l}`);
  console.error('');
  console.error('  修复方式(任选其一):');
  console.error('    1) pnpm install         # 重新应用 patches/uiohook-napi.patch');
  console.error('    2) pnpm rebuild:uiohook # 重新编译原生模块(Node20 + VS2017)');
  console.error('');
  process.exit(STRICT ? 1 : 0);
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

// 1) 定位模块(teacher 的软链指向带 patch_hash 的 .pnpm 目录)
const teacherLink = join(ROOT, 'apps', 'teacher', 'node_modules', 'uiohook-napi');
if (!existsSync(teacherLink)) {
  fail([`未找到 apps/teacher/node_modules/uiohook-napi,请先 pnpm install`]);
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
    `没有找到手工编译产物:${releaseDir}`,
    '此时 node-gyp-build 会回退到 prebuilds 官方包(没有 setMouseConsume / getConsumeMode),',
    '结果是「防止桌面误框选」失效(不会卡死,但桌面可能被误框选)。',
  ]);
}

const bin = join(releaseDir, releaseBins[0]);
const binStat = statSync(bin);
ok(`原生产物:${releaseBins[0]} (${binStat.size} bytes, ${binStat.mtime.toLocaleString('zh-CN')})`);

// 3) 版本校验:仅当用 Node20 加载才安全(用 Node22 加载会因 NAPI/threadsafe function 崩溃)
if (!process.versions.node.startsWith(`${EXPECTED_NODE_MAJOR}.`)) {
  console.log(
    `  ⚠️  当前 Node 版本 ${process.versions.node} 不是 ${EXPECTED_NODE_MAJOR}.x,` +
      '跳过实际加载(用不匹配的 Node 加载可能直接崩溃)。',
  );
  console.log(`     请用 Node ${EXPECTED_NODE_MAJOR} 运行本检查,或直接信任 build 产物。`);
  process.exit(0);
}

// 4) 读取 consume-mode
const require = createRequire(import.meta.url);
let mode;
try {
  const mod = require(join(moduleDir, 'dist', 'index.js'));
  const hook = mod.uIOhook;
  if (typeof hook.setMouseConsume !== 'function') {
    fail(['原生模块没有 setMouseConsume():加载到的是官方 prebuild(无补丁)。']);
  }
  if (typeof hook.getConsumeMode !== 'function') {
    fail(['原生模块没有 getConsumeMode():产物是旧版补丁(无法自检,按危险产物处理)。']);
  }
  mode = Number(hook.getConsumeMode());
} catch (err) {
  fail([`加载原生模块失败:${err?.message ?? err}`]);
}

if (mode !== EXPECTED_MODE) {
  fail([
    `consume-mode = ${mode},期望 ${EXPECTED_MODE}。`,
    mode === 1
      ? '这是会吞掉 DRAGGED/RELEASED 的旧版本 —— 画笔/板擦按下后光标会被冻结!'
      : '未知版本,无法确认「只吞 PRESSED」的语义。',
  ]);
}

ok(`consume-mode = ${mode}(只吞 PRESSED,放行 move/drag/release)`);
console.log('  🎉 原生鼠标钩子自检通过');
