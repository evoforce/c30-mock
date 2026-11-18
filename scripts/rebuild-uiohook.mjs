#!/usr/bin/env node
// 一键重编 uiohook-napi 原生模块(含 setMouseConsume / getConsumeMode 补丁能力)。
//
// 为什么需要这个脚本:
//   patches/uiohook-napi.patch 只改「源码」,真正生效的是 build/Release/uiohook_napi.node
//   这个手工编译的原生二进制(不进 git)。重装依赖 / 清缓存 / 换机器之后,必须重编一次,
//   否则 node-gyp-build 会回退到官方 prebuilds —— 那种产物没有 setMouseConsume,
//   或者(更糟)是旧补丁产物,一开启「吞 mousedown」就会把 DRAGGED 也吞掉导致光标卡死。
//
// 四种运行方式:
//   pnpm rebuild:uiohook                    强制重编 + 自检(改了 C 源码后用)
//   node scripts/rebuild-uiohook.mjs --if-needed   「按需」:产物比源码新就跳过编译(postinstall 用)
//   ... --strict                             缺工具链 / 自检失败时以非 0 退出(CI 用)
//   (默认无 flag = 强制重编,失败即失败)
//
// postinstall 里用 --if-needed:全新安装时会编译一次,之后重复 install 秒过;
// 若本机没有 VS2017/Node20,只告警不阻断安装(运行时还有主进程安全阀兜底,见 docs/retro-mouse-freeze-2026-11-18.md)。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const ARGS = process.argv.slice(2);
/** 产物比源码新就跳过编译(postinstall 用,避免每次 install 都重编) */
const IF_NEEDED = ARGS.includes('--if-needed');
/** 任何问题都以非 0 退出(CI 用) */
const STRICT = ARGS.includes('--strict');
/** MSVC 版本,可用 --msvs-version=2017 覆盖 */
const MSVS = (ARGS.find((a) => a.startsWith('--msvs-version=')) ?? '').split('=')[1] || '2017';

const VS2017_VCVARS =
  'C:/Program Files (x86)/Microsoft Visual Studio/2017/BuildTools/VC/Auxiliary/Build/vcvars64.bat';

function log(msg) {
  console.log(`[rebuild:uiohook] ${msg}`);
}

function die(msg) {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(1);
}

/**
 * 无法编译时:严格模式直接失败,否则告警并「跳过」(退出 0)。
 * 安装流程不能被环境问题搞挂 —— 而且主进程已有安全阀,旧产物不会被用来冻鼠标。
 */
function skip(msg, hints = []) {
  if (STRICT) die(msg);
  console.warn(`\n  ⚠️  ${msg}`);
  for (const h of hints) console.warn(`     ${h}`);
  console.warn('     已跳过原生编译(不会阻断 pnpm install)。运行时若检测到产物不匹配,');
  console.warn('     「吞 mousedown」会被自动禁用 —— 不会冻结鼠标,但桌面可能被误框选。');
  console.warn('     需要完整能力时请在本机补齐工具链后运行:pnpm rebuild:uiohook\n');
  process.exit(0);
}

// ---- 0. 平台 -------------------------------------------------------------------------
if (process.platform !== 'win32') {
  // 这套补丁的消费语义只在 Windows 下有实际意义;其它平台沿用官方 prebuild 即可
  log(`当前平台 ${process.platform},跳过原生编译。`);
  process.exit(0);
}

// ---- 1. 找 Node 20(编译必须用它:与 Electron 33 的 Node 20.18 ABI 对齐) -----------------
function findNode20() {
  const candidates = [
    process.env.UIOHOOK_NODE20, // 显式指定优先
    // Volta 安装的 Node 20(本机既有环境)
    'C:/Users/25421/scoop/apps/volta/current/appdata/tools/image/node/20.20.2/node.exe',
  ].filter(Boolean);

  // 当前运行的 node 若是 20.x,直接用它
  if (process.versions.node.startsWith('20.')) candidates.unshift(process.execPath);

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

// ---- 2. 找 node-gyp(npx 缓存里已有,避免联网) -------------------------------------------
function findNodeGyp() {
  const local = join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (existsSync(local)) return local;

  const npxRoot = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  if (existsSync(npxRoot)) {
    for (const dir of readdirSync(npxRoot)) {
      const gyp = join(npxRoot, dir, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
      if (existsSync(gyp)) return gyp;
    }
  }
  return null;
}

// ---- 3. 定位「带 patch_hash」的实际运行目录 --------------------------------------------
function findPatchedDir() {
  const link = join(ROOT, 'apps', 'teacher', 'node_modules', 'uiohook-napi');
  if (!existsSync(link)) return null;

  let resolved;
  try {
    resolved = realpathSync(link); // 解开 junction / symlink,拿到 .pnpm/..._patch_hash=... 真实目录
  } catch {
    resolved = resolve(link);
  }
  if (!existsSync(join(resolved, 'package.json'))) return null;
  if (!resolved.includes('_patch_hash')) {
    log(`⚠️  目录不带 patch_hash(${resolved})`);
    log('    补丁可能没生效,请先 pnpm install(确认 package.json 的 pnpm.patchedDependencies)');
  }
  return resolved;
}

const dir = findPatchedDir();
if (!dir) {
  skip('没找到 apps/teacher/node_modules/uiohook-napi(依赖还没装好?)', [
    '请先执行 pnpm install',
  ]);
}

// 源码 / 产物清单:用于「是否是最新的」判断
const SOURCES = [
  join(dir, 'src', 'lib', 'addon.c'),
  join(dir, 'dist', 'index.js'),
  join(dir, 'dist', 'index.d.ts'),
];
const BUILT = join(dir, 'build', 'Release', 'uiohook_napi.node');

// ---- 4. 自检封装 ---------------------------------------------------------------------
function verify(interpreter) {
  const verifyScript = join(HERE, 'verify-uiohook.mjs');
  const res = spawnSync(interpreter, [verifyScript, ...(STRICT ? ['--strict'] : [])], {
    stdio: 'inherit',
  });
  return res.status === 0;
}

// ---- 5. 产物是否已是最新(比所有源码都新,说明不用重编) ----------------------------------
function isUpToDate() {
  if (!existsSync(BUILT)) return false;
  const builtAt = statSync(BUILT).mtimeMs;
  return SOURCES.every((s) => !existsSync(s) || statSync(s).mtimeMs <= builtAt);
}

const node20 = findNode20();

if (IF_NEEDED && isUpToDate()) {
  log('产物已是最新(比补丁源码新),跳过编译。');
  if (!verify(node20 ?? process.execPath)) {
    skip('产物自检未通过(consume-mode 不是 2 或模块无法加载)。', [
      '请运行 pnpm rebuild:uiohook 重新编译。',
    ]);
  }
  log('完成 ✅');
  process.exit(0);
}

// ---- 6. 工具链检查 -------------------------------------------------------------------
if (!node20) {
  skip('没找到 Node 20(编译必须用 Node20:Electron 33 内嵌 Node 20.18)。', [
    '安装:volta install node@20',
    '或用 UIOHOOK_NODE20=/path/to/node20 指定。',
  ]);
}
const nodeGyp = findNodeGyp();
if (!nodeGyp) {
  skip('没找到 node-gyp(npx 缓存里也没有)。', [
    '在本仓库根目录执行一次:npx node-gyp --version(会缓存到 npx 目录)。',
  ]);
}
if (!existsSync(VS2017_VCVARS)) {
  skip(`没找到 VS${MSVS} Build Tools:${VS2017_VCVARS}`, [
    '安装 Visual Studio 2017 Build Tools(含 C++ 生成工具),',
    '或用 --msvs-version=<版本> 指定已安装的版本。',
  ]);
}

// ---- 7. 编译 -------------------------------------------------------------------------
log(`编译目录: ${dir}`);
log(`Node 20 : ${node20}`);
log('开始编译(首次约 1-3 分钟)…');

const res = spawnSync(node20, [nodeGyp, 'rebuild', `--msvs_version=${MSVS}`, '--directory', dir], {
  stdio: 'inherit',
});

if (res.error || res.status !== 0) {
  const hint = [
    '最常见原因:教师端还在运行,占用了 build/Release/uiohook_napi.node。',
    '请先退出教师端(pnpm dev 的窗口),再重跑 pnpm rebuild:uiohook。',
  ];
  // skip():非严格模式告警后退出 0(安装流程不被环境问题阻断);严格模式直接非 0 退出
  skip(`node-gyp 编译失败(exit=${res.status ?? 'null'})。`, hint);
}

// ---- 8. 删除官方 prebuilds 的 win32 .node,确保 node-gyp-build 加载 build/Release --------
const prebuild = join(dir, 'prebuilds', 'win32-x64');
if (existsSync(prebuild)) {
  for (const f of readdirSync(prebuild)) {
    if (f.endsWith('.node')) {
      rmSync(join(prebuild, f), { force: true });
      log(`已删除官方预编译产物:prebuilds/win32-x64/${f}`);
    }
  }
}

if (!existsSync(BUILT)) die(`编译产物不存在:${BUILT}`);
const st = statSync(BUILT);
log(`产物: ${st.size} bytes, ${st.mtime.toLocaleString('zh-CN')}`);

// ---- 9. 自检(consume-mode 必须 = 2) --------------------------------------------------
log('运行自检…');
if (!verify(node20)) die('自检未通过,请检查上面的输出。');
log('完成 ✅');
