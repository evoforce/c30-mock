#!/usr/bin/env node
/**
 * 编译 Windows 定制安装器（Inno Setup）。
 *
 * 产物：apps/<app>/release/C30-<Teacher|Student>-Setup-<version>-<arch>.exe
 *
 * 两种用法：
 *   1) 全流程（先出 electron-builder 的 win-*-unpacked，再用 Inno 打包）
 *        node scripts/build-installer.mjs --app teacher --arch x64
 *   2) 只调界面（直接用现成目录当 payload，跳过 electron-builder）
 *        node scripts/build-installer.mjs --app teacher --payload D:\tmp\payload
 *
 * 参数：
 *   --app <teacher|student>   必填
 *   --arch <x64|arm64>        默认 x64
 *   --payload <dir>           直接指定 payload 目录（隐含 --skip-build）
 *   --skip-build              不跑 electron-builder，复用已有 win-*-unpacked
 *   --iscc <path>             ISCC.exe；默认 %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ISSET_DIR = path.join(ROOT, 'scripts', 'installer');

/**
 * 安装器 AppId（GUID）必须永久固定：Inno 用它识别"同一个应用"，
 * 一旦改动，老版本就再也无法被新安装包升级/正常卸载（会并排装两份）。
 * 这里的值一次性生成后不要再改；新增应用时追加新条目。
 */
const APP_META = {
  teacher: { appId: '{{7C1E2B4A-9D31-4F62-9A18-0E5C7B3D4F11}', label: 'Teacher' },
  student: { appId: '{{9A4D6C22-3B78-4E15-8C07-2F91A6B5D8E3}', label: 'Student' },
};

/** electron-builder --dir 的产物目录名 */
const UNPACKED_DIR = { x64: 'win-unpacked', arm64: 'win-arm64-unpacked' };
/** Inno 架构标识：x64compatible 让 x64 包在 Arm64 Win11 上也能装、且以 64 位模式安装 */
const INNO_ARCH = { x64: 'x64compatible', arm64: 'arm64' };

function fail(msg) {
  console.error(`\n[build-installer] ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { arch: 'x64' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skip-build') out.skipBuild = true;
    else if (a === '--compression') out.compression = argv[++i];
    else if (a === '--app') out.app = argv[++i];
    else if (a === '--arch') out.arch = argv[++i];
    else if (a === '--payload') out.payload = argv[++i];
    else if (a === '--iscc') out.iscc = argv[++i];
    else fail(`未知参数：${a}`);
  }
  if (!out.app) fail('缺少 --app teacher|student');
  if (!APP_META[out.app]) fail(`未知应用：${out.app}`);
  if (!UNPACKED_DIR[out.arch]) fail(`未知架构：${out.arch}（支持 x64 / arm64）`);
  if (out.payload) out.skipBuild = true;
  return out;
}

function findIscc(explicit) {
  const candidates = [
    explicit,
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return fail(
    '找不到 ISCC.exe（Inno Setup 6 编译器）。\n' +
      '  安装：https://jrsoftware.org/isdl.php （或用 winget install JRSoftware.InnoSetup）\n' +
      '  或显式指定：--iscc "C:\\path\\to\\ISCC.exe"',
  );
}

function run(cmd, args, opts = {}) {
  // 注意：不能给带空格的路径（如 ...\Inno Setup 6\ISCC.exe）套 shell，
  // Windows 下 Node 会把 argv 拼成一条命令行，引号会丢，路径被空格截断。
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) fail(`${cmd} 启动失败：${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} 退出码 ${r.status}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = path.join(ROOT, 'apps', args.app);
  const pkgPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(pkgPath)) fail(`找不到 ${pkgPath}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const productName = pkg.build?.productName ?? pkg.name;
  const version = pkg.version;
  const exeName = `${productName}.exe`;
  const meta = APP_META[args.app];

  const releaseDir = path.join(appDir, 'release');
  const payloadDir = args.payload
    ? path.resolve(args.payload)
    : path.join(releaseDir, UNPACKED_DIR[args.arch]);

  // 1) 应用本体
  if (!args.skipBuild) {
    console.log(`[build-installer] electron-builder --win --dir --${args.arch}`);
    fs.rmSync(payloadDir, { recursive: true, force: true });
    // 不经过 pnpm/shell：Node 20 spawn .cmd/.ps1 会 EINVAL，直接调 electron-builder 的 cli.js
    const ebCli = findElectronBuilderCli();
    run(process.execPath, [ebCli, '--win', '--dir', `--${args.arch}`], { cwd: appDir });
  }
  if (!fs.existsSync(payloadDir)) fail(`payload 目录不存在：${payloadDir}`);
  const payloadSize = dirSize(payloadDir);
  if (payloadSize === 0) fail(`payload 目录为空：${payloadDir}`);
  if (!fs.existsSync(path.join(payloadDir, exeName))) {
    console.warn(
      `[build-installer] 警告：payload 里没有 ${exeName}，主程序名可能与 productName 不一致，` +
        `[Run]/[Icons] 会指向不存在的文件。`,
    );
  }

  // 2) 生成带 BOM 的脚本副本（ISCC 需要 BOM 才会按 UTF-8 解析中文）
  const template = fs.readFileSync(path.join(ISSET_DIR, 'installer.iss'), 'utf8');
  const buildDir = path.join(ISSET_DIR, '.build');
  fs.mkdirSync(buildDir, { recursive: true });
  const issPath = path.join(buildDir, `setup-${args.app}-${args.arch}.iss`);
  fs.writeFileSync(issPath, '\uFEFF' + template, 'utf8');

  const baseName = `C30-${meta.label}-Setup-${version}-${args.arch}`;
  const emptyDir = path.join(buildDir, 'empty-out');
  fs.mkdirSync(emptyDir, { recursive: true });

  const defines = [
    [`AppName`, productName],
    [`AppVersion`, version],
    [`AppExeName`, exeName],
    [`AppDirName`, productName],
    [`AppPublisher`, pkg.build?.copyright ?? 'C30'],
    [`AppId`, meta.appId],
    [`PayloadDir`, payloadDir],
    [`AssetDir`, path.join(ROOT, 'assets', 'installer')],
    [`OutputDir`, emptyDir],
    [`OutputBaseFilename`, baseName],
    [`SetupIcon`, path.join(ROOT, 'assets', 'logo', 'c30.ico')],
    [`LangFile`, path.join(ISSET_DIR, 'ChineseSimplified.isl')],
    [`Arch`, INNO_ARCH[args.arch]],
    [`ArchSlug`, args.arch],
    [`CompressionMethod`, args.compression ?? 'lzma2/max'],
  ].map(([k, v]) => `/D${k}=${v}`);

  // 3) 编译
  const iscc = findIscc(args.iscc);
  console.log(`[build-installer] ${productName} ${version} · ${args.arch} · payload ${(payloadSize / 1024 / 1024).toFixed(1)} MB`);
  run(iscc, [...defines, issPath]);

  // 4) 归位
  const built = path.join(emptyDir, `${baseName}.exe`);
  if (!fs.existsSync(built)) fail(`编译完成但没找到产物：${built}`);
  fs.mkdirSync(releaseDir, { recursive: true });
  const finalPath = path.join(releaseDir, `${baseName}.exe`);
  try {
    fs.copyFileSync(built, finalPath);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      fail(`产物被占用，无法写入：${finalPath}\n  多半是上一次的安装程序还在运行，先关掉再重试。`);
    }
    throw e;
  }

  const size = fs.statSync(finalPath).size;
  const sha = createHash('sha256').update(fs.readFileSync(finalPath)).digest('hex');
  console.log(
    `[build-installer] 完成：${path.relative(ROOT, finalPath)}\n` +
      `                  ${(size / 1024 / 1024).toFixed(1)} MB  sha256=${sha}`,
  );
}

/** 定位 electron-builder 的 cli.js（pnpm 的 .bin 是 .cmd/.ps1，Node 20 不能直接 spawn） */
function findElectronBuilderCli() {
  const direct = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  if (fs.existsSync(direct)) return direct;
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const name of fs.readdirSync(pnpmDir)) {
      if (!name.startsWith('electron-builder@')) continue;
      const candidate = path.join(pnpmDir, name, 'node_modules', 'electron-builder', 'cli.js');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return fail('找不到 electron-builder 的 cli.js，先跑 pnpm install');
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(p);
      else total += fs.statSync(p).size;
    }
  }
  return total;
}

main();
