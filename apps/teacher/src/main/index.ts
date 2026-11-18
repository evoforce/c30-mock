import { app, shell, BrowserWindow, ipcMain, screen, session, Tray, Menu, nativeImage, desktopCapturer } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { writeFile, readFile, appendFile, mkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { networkInterfaces } from 'os';
import { mdsd } from '@c30/mdsd';
import { createLocalSessionServer, type LocalSessionServer } from './localSessionServer';
import { uIOhook, UiohookMouseEvent } from 'uiohook-napi';

let mainWindow: BrowserWindow | null = null;
let localServer: LocalSessionServer | null = null;
let tray: Tray | null = null;

// 开发态(electron-vite dev)使用独立 userData:
// 否则开发实例会和已安装版抢同一个单例锁,开发时的设置 / 诊断日志也会污染真实配置。
// 必须放在 app.requestSingleInstanceLock() 之前:单例锁就是按 userData 目录区分的。
if (process.env['ELECTRON_RENDERER_URL']) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

// 教师端本地设置(持久化到 userData/settings.json)
interface AppSettings {
  // 开机自启
  autoLaunch: boolean;
  // 是否展示教室信息(右上角状态条)
  showClassInfo: boolean;
  // 是否允许互动(关闭时底部互动按钮置灰)
  allowInteraction: boolean;
}
const DEFAULT_SETTINGS: AppSettings = {
  autoLaunch: false,
  showClassInfo: true,
  allowInteraction: true,
};
let settings: AppSettings = { ...DEFAULT_SETTINGS };

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

// 从磁盘加载设置(启动时调用)
async function loadSettings(): Promise<void> {
  try {
    const raw = await readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    settings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  // 应用开机自启(同步到系统登录项)
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
  } catch (err) {
    console.warn('[settings] failed to apply auto-launch:', (err as Error)?.message ?? String(err));
  }
}

// 持久化设置(写盘 + 应用副作用)
async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  settings = { ...settings, ...patch };
  try {
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[settings] failed to write settings:', (err as Error)?.message ?? String(err));
  }
  // 副作用:开机自启
  if (patch.autoLaunch !== undefined) {
    try {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch });
    } catch (err) {
      console.warn('[settings] failed to apply auto-launch:', (err as Error)?.message ?? String(err));
    }
  }
  return settings;
}

function registerSettings(): void {
  ipcMain.handle('settings:get', async () => settings);
  ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
    return saveSettings(patch);
  });
}

// 屏幕共享相关(教师端 → 学生端):
//   1) setDisplayMediaRequestHandler:让渲染层 getDisplayMedia() 直接拿主屏,
//      不弹系统选择器(老师点「上课/投屏」就开始共享);
//   2) screen:protect:共享期间给悬浮层开启内容保护(WDA_EXCLUDEFROMCAPTURE),
//      确保采集到的画面里没有侧边栏/工具栏/画笔面板,也不会和笔迹重影。
function registerScreenShare(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const primaryId = String(screen.getPrimaryDisplay().id);
        const primary = sources.find((s) => s.display_id === primaryId) ?? sources[0];
        if (!primary) {
          callback({});
          return;
        }
        callback({ video: primary });
      } catch (err) {
        console.warn('[screen-share] getDisplayMedia handler failed:', (err as Error)?.message ?? String(err));
        callback({});
      }
    },
    { useSystemPicker: false },
  );

  ipcMain.on('screen:protect', (_e, on: boolean) => {
    try {
      mainWindow?.setContentProtection(!!on);
    } catch (err) {
      console.warn('[screen-share] setContentProtection failed:', (err as Error)?.message ?? String(err));
    }
  });
}

// 应用信息 / 退出(侧边栏「菜单」的「关于 / 退出」)
function registerAppControl(): void {
  // 版本号给「关于」面板展示
  ipcMain.handle('app:get-version', () => app.getVersion());
  // 渲染层「菜单 → 退出」:与托盘「退出」共用同一个真实退出入口
  ipcMain.on('app:quit', () => {
    quitApp();
  });
}
// 是否处于「桌面批注」绘制状态(渲染层切到画笔/板擦等工具时开启)
let annotationActive = false;
// 鼠标当前是否悬停在可交互组件(悬浮栏/面板)上。由渲染层 hover 检测经
// pointer:set-interactive 实时上报。用于决定是否「吞掉 mousedown」:
// 批注模式下,鼠标在空白区(即将在桌面书写)时吞掉 mousedown 阻止桌面框选;
// 鼠标在悬浮栏上时不吞,保证悬浮栏可点。
let pointerInteractive = false;
// 当前「吞掉 mousedown」的原生状态缓存,避免 mousemove 高频重复调用 setMouseConsume
let consumeOn = false;
// 是否真正退出(托盘「退出」/ 侧边栏「菜单 → 退出」时置 true,避免 close 被拦成托盘常驻)
let isQuitting = false;

// 统一的「真实退出软件」入口:托盘右键「退出」与渲染层「菜单 → 退出」都走这里。
// 关键:必须先置 isQuitting —— 否则窗口 close 事件会 preventDefault 变成「最小化到托盘」,
// app.quit() 永远退不掉。真正的清理(内嵌服务器 / uIOhook)在下面的 will-quit 里。
function quitApp(): void {
  if (isQuitting) return;
  isQuitting = true;
  app.quit();
}

// 穿透/点击问题诊断日志(写到 userData/pointer-diag.log)。
// 只在「状态切换」这类低频时机写一行,正常使用几乎为空;POINTER_DIAG=0 可关闭。
function diag(msg: string): void {
  if (process.env.POINTER_DIAG === '0') return;
  const line = `${new Date().toISOString()} ${msg}\n`;
  appendFile(join(app.getPath('userData'), 'pointer-diag.log'), line).catch(() => {});
}

// 获取本机局域网 IPv4 地址(mDNS 广播 / 学生端直连都用它)。
// 不能简单取「第一个非 internal IPv4」:本机常同时存在 Meta/Clash 的 198.18.0.1、
// Hyper-V 的 172.22.x、未连接网卡的 169.254.x,取到它们时同局域网的另一台机器
// (比如 Mac 学生端)根本连不上。这里按真实局域网网段打分,并跳过 APIPA / 198.18/15。
function getLanIP(): string {
  const nets = networkInterfaces();
  let best = '';
  let bestScore = -1;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const addr = net.address;
      // APIPA(未拿到 DHCP)与 198.18.0.0/15(RFC 2544 基准测试段,常见于 Clash/Meta TUN)
      if (addr.startsWith('169.254.')) continue;
      if (/^198\.(18|19)\./.test(addr)) continue;
      let score = 1;
      if (addr.startsWith('192.168.')) score = 3; // 家用/办公 Wi-Fi 最常见
      else if (addr.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score = 2;
      if (score > bestScore) {
        bestScore = score;
        best = addr;
      }
    }
  }
  return best || '127.0.0.1';
}

function createWindow(): void {
  // 主窗口 = 全屏透明悬浮层,覆盖桌面,桌面壁纸/图标透出
  const { width, height } = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    show: false,
    frame: false,
    // 关键:Windows 上 type:'toolbar' 使用 WS_EX_TOOLWINDOW 样式,
    // 窗口永不抢占系统「前台活动窗口」身份,不会把下方浏览器挤成后台。
    // 否则点击悬浮栏按钮时,窗口被激活为前台,浏览器(bilibili)被降级为后台
    // 标签页,触发 Chromium backgroundThrottling,导致 <video> 与 CSS 动画冻结。
    type: 'toolbar',
    transparent: true, // 透明背景,桌面内容透出
    backgroundColor: '#00000000', // 透明
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true, // 不显示在任务栏(以托盘常驻)
    alwaysOnTop: true, // 始终置顶(浮层盖在浏览器/PPT 等之上)
    // 让悬浮层永不抢占键盘焦点(配合 type:'toolbar' 彻底不抢前台)
    focusable: false,
    autoHideMenuBar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 关键:禁用 Chromium 的「失焦节流」,保证画笔/板擦动画在窗口非活动时
      // 仍满帧渲染(否则画笔笔迹会因失焦被节流而卡顿)。
      backgroundThrottling: false,
    },
  });

  // 默认穿透到桌面(可操作桌面),仅当渲染层判定鼠标悬停在可交互组件上时关闭穿透
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // 置顶层级:始终盖在普通窗口(浏览器/PPT)之上。用 'floating' 而非 'screen-saver':
  // screen-saver 层级过高,在透明窗口上易触发 DWM 合成黑屏/闪烁,floating 已足够盖住普通窗口。
  mainWindow.setAlwaysOnTop(true, 'floating');

  // 关闭窗口时最小化到托盘(而非退出应用)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('ready-to-show', () => {
    // 用 showInactive() 显示窗口:不激活、不抢前台焦点(比 show() 更彻底)。
    // 配合 type:'toolbar' + focusable:false,确保悬浮层显示/交互时绝不把
    // 下方浏览器(bilibili)挤成后台标签页(否则触发 backgroundThrottling 冻结视频)。
    mainWindow?.showInactive();
    mainWindow?.setFocusable(false);
  });

  // 窗口重新显示(托盘显示等)时,重挂一次穿透与 forward 转发,并推一次鼠标位置;
  // 顺带把「吞 mousedown」复位(非批注态),避免浮层出现「看得见却点不动」。
  mainWindow.on('show', () => {
    if (!annotationActive) {
      applyConsume(false);
    }
    reapplyPassthrough();
  });

  // 渲染进程崩溃时留一条主进程日志(渲染层 console 不再转发到终端,避免刷屏)
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', JSON.stringify(details));
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    // 渲染层 console 默认不再转发到终端(避免开发时刷屏)。需要看时用 C30_DEVTOOLS=1 启动:
    //   C30_DEVTOOLS=1 pnpm --filter @c30/teacher dev
    if (process.env.C30_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 启动「鼠标位置兜底同步」:forward 转发失效时仍能正确判定悬停,避免浮层点不动
  startCursorSyncFallback();
}

// 原生模块「吞事件」实现版本号(与 node_modules/uiohook-napi/src/lib/addon.c 的
// UIOHOOK_CONSUME_MODE_VERSION 对应):
//   2 = 只吞 EVENT_MOUSE_PRESSED(放行 move/drag/release)—— 唯一允许使用的版本;
//   1 或缺失 = 旧产物(吞 DRAGGED/RELEASED 或根本没有该能力)—— 会冻结光标,禁止开启。
const CONSUME_MODE_PRESSED_ONLY = 2;

// 启动自检结果缓存(只检查一次,避免每帧调用原生函数)
let consumeModeChecked = false;
let consumeModeOk = false;

/**
 * 校验当前加载的原生模块是否支持「只吞 PRESSED」。
 *
 * 为什么要这个自检(踩过三次的坑):
 *   这个补丁是「补丁源码 + 手工编译的原生 .node」两级产物,两者都可能落后于
 *   patches/uiohook-napi.patch。一旦加载到旧 .node(吞 DRAGGED/RELEASED),
 *   setMouseConsume(true) 就会把「按下后的鼠标移动」一起吞掉 → 光标冻结、
 *   老师只能 Ctrl+Alt+Del。因此宁可放弃「防止桌面误框选」,也绝不能在旧产物上开启。
 */
function consumeModeSupported(): boolean {
  if (consumeModeChecked) return consumeModeOk;
  consumeModeChecked = true;

  const getMode = (uIOhook as unknown as { getConsumeMode?: () => number }).getConsumeMode;
  if (typeof getMode !== 'function') {
    console.error(
      '[batch] native module has no getConsumeMode(): old prebuild/artifact loaded; ' +
        'mousedown swallowing disabled (otherwise the cursor freezes after pressing). Fix: pnpm rebuild:uiohook',
    );
    consumeModeOk = false;
    return false;
  }
  try {
    const mode = Number(getMode.call(uIOhook));
    consumeModeOk = mode === CONSUME_MODE_PRESSED_ONLY;
    if (!consumeModeOk) {
      console.error(
        `[batch] native consume-mode=${mode} (expected ${CONSUME_MODE_PRESSED_ONLY}); ` +
          'not a PRESSED-only build, mousedown swallowing disabled. Fix: pnpm rebuild:uiohook',
      );
    } else {
      diag(`consume-mode=${mode}`);
    }
  } catch (err) {
    console.error('[batch] failed to read consume-mode, mousedown swallowing disabled:', (err as Error)?.message ?? String(err));
    consumeModeOk = false;
  }
  return consumeModeOk;
}

// 设置「吞掉 mousedown」状态(带缓存,幂等)。当 on=true 时,C 层只吞
// EVENT_MOUSE_PRESSED(放行 move/up),桌面收不到「按下」即不会框选/拖动,
// 而光标仍可正常移动、笔迹正常绘制。
function applyConsume(on: boolean): void {
  // 临时实验开关:设置 NO_CONSUME=1 时禁用「吞 mousedown」,用于对照定位
  // 视频暂停问题是否由吞事件导致。
  if (process.env.NO_CONSUME === '1') {
    on = false;
  }
  // 安全阀:旧原生产物会让光标卡死,直接降级为「不吞」
  if (on && !consumeModeSupported()) {
    on = false;
  }
  if (on === consumeOn) return;
  consumeOn = on;
  diag(`consume=${on} (annotation=${annotationActive})`);
  try {
    uIOhook.setMouseConsume(on);
  } catch (err) {
    console.warn('[batch] setMouseConsume failed:', (err as Error)?.message ?? String(err));
  }
}

// 鼠标穿透控制:悬浮层默认穿透到桌面,仅可交互区域(导航条/面板)关闭穿透。
// 书写时的「误框选」由全局鼠标钩子的 setMouseConsume 在系统层吞掉事件解决,
// 窗口本身始终保持穿透,不再在书写期间切换穿透状态(避免状态机错乱)。
function registerPointerControl(): void {
  // interactive=true 时捕获鼠标(悬浮组件可交互),false 时穿透到桌面
  ipcMain.handle('pointer:set-interactive', (_e, interactive: boolean) => {
    pointerInteractive = interactive;
    diag(`set-interactive=${interactive} (annotation=${annotationActive})`);
    // hover 变化立即同步 consume:批注模式下,悬停悬浮栏(interactive=true)
    // 时不吞(悬浮栏可点),移到空白区(interactive=false)时吞(准备书写)。
    if (annotationActive) {
      applyConsume(!interactive);
    }
    if (!mainWindow) return { ok: false };
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 穿透态的「兜底」与「重挂」:
// forward:true 的 mousemove 转发并不是一定可靠的——窗口 hide→show 后、GPU 进程重建后,
// 转发链路可能静默失效(不报错,就是不转发)。此时渲染层收不到 mousemove,悬停检测永远
// 不触发,浮层会一直停在穿透态(表现:聚焦保存→取消、或托盘隐藏再显示后,工具栏/浮层
// 点不动)。因此这里做两件事:
//   ①窗口重新显示后重挂一次 setIgnoreMouseEvents,让转发钩子重新生效;
//   ②主动把鼠标位置推给渲染层,由渲染层用 elementFromPoint 自行判定悬停,
//     完全不依赖转发链路(也解决「对话框关闭后鼠标不动、等不到 mousemove」)。
// ---------------------------------------------------------------------------
let cursorSyncTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncedCursor: { x: number; y: number } | null = null;

// 推送当前鼠标位置(换算成渲染层 CSS 像素)。force=false 时位置没变则不重复推送。
function syncCursorToRenderer(force = false): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    const p = { x: Math.round(cursor.x - bounds.x), y: Math.round(cursor.y - bounds.y) };
    if (!force && lastSyncedCursor && lastSyncedCursor.x === p.x && lastSyncedCursor.y === p.y) return;
    lastSyncedCursor = p;
    win.webContents.send('pointer:sync-cursor', p);
  } catch (err) {
    console.warn('[pointer] failed to sync cursor:', (err as Error)?.message ?? String(err));
  }
}

// 兜底轮询:仅在「穿透态」下每 60ms 推一次鼠标位置(位置变化才真发),
// 一旦切成交互态就停(此时窗口能收到真实 DOM 鼠标事件,无需兜底)。
function startCursorSyncFallback(): void {
  if (cursorSyncTimer) return;
  cursorSyncTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (pointerInteractive) return;
    syncCursorToRenderer();
  }, 60);
}

// 窗口重新显示后重挂「穿透 + forward」状态。传值就是渲染层最近一次上报的
// pointerInteractive,与渲染层缓存保持一致,不会造成状态失同步。
function reapplyPassthrough(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.setIgnoreMouseEvents(!pointerInteractive, { forward: true });
    diag(`reapply ignore=${!pointerInteractive} visible=${win.isVisible()}`);
  } catch (err) {
    console.warn('[pointer] failed to re-apply passthrough:', (err as Error)?.message ?? String(err));
  }
  // 立即推一次鼠标位置:让渲染层不等 mousemove 就能纠正穿透状态
  syncCursorToRenderer(true);
}

// 托盘图标解析:优先用打包后的 assets/tray,回退到仓库 assets/logo/png,
// 最后才退回内置 16x16 兜底(保证任何情况下托盘都不会「空白一块」)。
// Windows 会按 DPI 选择:16(100%)/20(125%)/24(150%)/32(200%)/40(250%)/48。
function trayIconPath(): string | null {
  const candidates = [
    // ① 打包后:electron-builder 把 build 之外的 assets 目录原样带入 resources
    join(process.resourcesPath, 'assets', 'tray', 'tray-32.png'),
    // ② 开发环境(__dirname = out/main)
    join(__dirname, '../../assets/tray/tray-32.png'),
    join(__dirname, '../../../../assets/tray/tray-32.png'),
    // ③ 仓库源
    join(__dirname, '../../../../assets/logo/png/tray-32.png'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* 忽略权限等异常,继续下一个候选 */
    }
  }
  return null;
}

function loadTrayImage(): Electron.NativeImage {
  const p = trayIconPath();
  if (p) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      return img;
    }
    console.warn('[tray] icon file exists but failed to decode:', p);
  }
  // 兜底:生成一个 16x16 纯色图标(至少保证托盘可见、菜单可点)
  const fallback = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    fallback[i * 4 + 0] = 0x1e; // R
    fallback[i * 4 + 1] = 0x3a; // G
    fallback[i * 4 + 2] = 0x8a; // B
    fallback[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(fallback, { width: 16, height: 16 });
}

// 系统托盘:常驻托盘,无任务栏图标;点击显示/隐藏悬浮层,右键退出
function createTray(): void {
  const icon = loadTrayImage();
  tray = new Tray(icon);
  tray.setToolTip('C30 教学');
  const menu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: () => {
      if (mainWindow?.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow?.show();
      }
    } },
    { label: '退出', click: () => {
      quitApp();
    } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

// 全局鼠标钩子:监听系统级鼠标事件,在「桌面批注」状态下转发给渲染层绘制。
// 这样批注窗口可始终保持穿透(桌面/浏览器/PPT 均可操作),批注由钩子轨迹叠加显示,
// 实现 C30 式「画笔不冻结画面、仍可操作桌面」。
//
// 性能优化:①uIOhook 返回「物理像素」坐标,在此换算为「逻辑像素」(除以 scaleFactor),
// 消除 DPI 缩放下的笔迹偏移;②mousemove 高频事件做时间节流(约 125Hz),降低 IPC 开销。
//
// 「吞掉 mousedown」策略(阻止桌面误框选/拖动):
// C 层 setMouseConsume(true) 时,只吞 EVENT_MOUSE_PRESSED,放行 DRAGGED/RELEASED。
// 这样桌面收不到「按下」就不会进入框选/拖动状态,而 mousemove 仍正常传递(光标可动)。
// 关键在于 consume 状态必须在「按下之前」就绪——若在 mousedown 回调里才开启,
// 第一次 mousedown 永远来不及被吞。因此这里在 mousemove(按下前必有的高频事件)里
// 根据「是否悬停在悬浮栏上」持续维护 consume:空白区→吞,悬浮栏上→不吞。
function registerGlobalMouseHook(): void {
  let lastMoveTs = 0;
  const MOVE_THROTTLE_MS = 8; // 约 125Hz,足以保证流畅笔迹

  // 物理坐标 → 逻辑坐标(与渲染层 canvas 的 CSS 像素对齐)
  const toLogical = (e: UiohookMouseEvent): { x: number; y: number } => {
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    return { x: Math.round(e.x / sf), y: Math.round(e.y / sf) };
  };

  try {
    // 决定性实验开关:NO_HOOK=1 时完全不启动 libuiohook 钩子线程
    // (不装 WH_MOUSE_LL / WH_KEYBOARD_LL / SetWinEventHook / 83ms 前台定时器),
    // 用于判断「视频暂停」是否由 libuiohook 的系统钩子本身导致。
    if (process.env.NO_HOOK === '1') {
      console.log('[env-check] NO_HOOK=1: skipping uIOhook.start(), no system hook installed');
      return;
    }

    uIOhook.on('mousedown', (e: UiohookMouseEvent) => {
      if (annotationActive && mainWindow) {
        const leftBtn = e.button === 0 || e.button === 1;
        if (leftBtn && !pointerInteractive) {
          lastMoveTs = Date.now();
          if (process.env.NO_FORWARD !== '1') {
            const p = toLogical(e);
            mainWindow.webContents.send('batch:mousedown', { x: p.x, y: p.y, button: e.button });
          }
        }
      }
    });
    uIOhook.on('mousemove', (e: UiohookMouseEvent) => {
      if (annotationActive) {
        applyConsume(!pointerInteractive);
      }

      if (!mainWindow || pointerInteractive) return;
      if (process.env.NO_FORWARD === '1') return;
      const now = Date.now();
      if (now - lastMoveTs < MOVE_THROTTLE_MS) return;
      lastMoveTs = now;
      const p = toLogical(e);
      mainWindow.webContents.send('batch:mousemove', { x: p.x, y: p.y });
    });
    uIOhook.on('mouseup', (e: UiohookMouseEvent) => {
      if (annotationActive && mainWindow) {
        lastMoveTs = 0;
        if (process.env.NO_FORWARD !== '1') {
          const p = toLogical(e);
          mainWindow.webContents.send('batch:mouseup', { x: p.x, y: p.y, button: e.button });
        }
      }
    });
    uIOhook.start();
  } catch (err) {
    console.warn('[batch] global mouse hook failed to start (drawing falls back to window capture):', (err as Error)?.message ?? String(err));
  }
}

// 批注状态控制:渲染层切到画笔/板擦等工具时开启钩子转发,切回选择时关闭
function registerAnnotationControl(): void {
  ipcMain.on('batch:set-active', (_e, active: boolean) => {
    annotationActive = active;
    if (active) {
      // 进入批注模式:若鼠标当前不在悬浮栏上,立即吞掉后续 mousedown,
      // 保证切到画笔后直接点桌面也能被拦截(不依赖 mousemove 预热)。
      applyConsume(!pointerInteractive);
    } else {
      // 关闭批注:复位吞事件状态,恢复桌面完全可操作
      applyConsume(false);
    }
  });
}

// 白板全屏控制:白板需要「全白盖满整个屏幕」,包括系统任务栏。
// 任务栏属于 HWND_TOPMOST 层级,普通 floating 层级盖不住它,
// 因此白板进入时临时提升到 screen-saver 层级(能盖住任务栏),
// 退出白板时降回 floating(平时悬浮层用较低层级,避免透明合成副作用)。
function registerWhiteboardControl(): void {
  ipcMain.on('whiteboard:set-fullscreen', (_e, fullscreen: boolean) => {
    if (!mainWindow) return;
    try {
      if (fullscreen) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      } else {
        mainWindow.setAlwaysOnTop(true, 'floating');
      }
    } catch (err) {
      console.warn('[whiteboard] failed to switch window level:', (err as Error)?.message ?? String(err));
    }
  });
}

// 聚焦(关灯)截屏能力:截取屏幕指定矩形区域,供「插入白板」「保存」使用。
// rect 为逻辑坐标(渲染层 CSS 像素),desktopCapturer 返回物理像素,需乘 scaleFactor。
interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 截取屏幕指定区域 → 返回 PNG dataURL(base64)。
// 调用方必须保证「窗口上没有需要排除的装饰」:聚焦层(遮罩/挖孔框/手柄)由渲染层先卸载,
// 放大镜标题装饰由渲染层先隐藏。这里不再隐藏/移动窗口——实测「真实点击后隐藏或移出屏幕
// 再恢复」会让这个透明无激活窗口永久丢失鼠标按下事件(整个浮层点不动)。
async function captureScreenRect(rect: SpotlightRect): Promise<string | null> {
  try {
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width * sf),
        height: Math.round(display.bounds.height * sf),
      },
    });
    if (sources.length === 0) return null;
    // 取主屏幕源(若多屏,可按 rect 坐标所在屏幕匹配;首期简化取第一个)
    const source = sources[0];
    const img = source.thumbnail;
    // 裁剪矩形(物理像素)
    const crop = img.crop({
      x: Math.round(rect.x * sf),
      y: Math.round(rect.y * sf),
      width: Math.round(rect.w * sf),
      height: Math.round(rect.h * sf),
    });
    return crop.toDataURL();
  } catch (err) {
    console.warn('[spotlight] screen capture failed:', (err as Error)?.message ?? String(err));
    return null;
  }
}


function registerSpotlightControl(): void {
  // 截屏返回 dataURL(供插入白板/放大镜)。调用前渲染层需先卸载聚焦层/隐藏装饰。
  ipcMain.handle('spotlight:capture', async (_e, rect: SpotlightRect) => {
    return captureScreenRect(rect);
  });

  // 快速保存聚焦截图:直接存到「图片/C30聚焦/聚焦_<时间>.png」,由渲染层弹提示。
  // 重要:这里刻意不使用原生「另存为」对话框(dialog.showSaveDialog)——
  // Windows 上该原生模态窗口关闭后,会让本浮层(透明 + WS_EX_NOACTIVATE + type:'toolbar')
  // 丢掉鼠标「按下」事件(mousemove 仍能收到),表现为整个浮层「看得见、点不动」:
  // 底部工具条/收起/侧边栏全部无响应,且 setIgnoreMouseEvents 重挂、移出屏幕都无法恢复,
  // 只能重启应用。实测可稳定复现,故保存走「直接落盘 + 渲染层提示」的路径。
  ipcMain.handle('spotlight:save-quick', async (_e, rect: SpotlightRect) => {
    try {
      // 截屏:聚焦层在点「保存」时已由渲染层卸载,窗口本身透明、不再有任何装饰,
      // 因此这里既不需要隐藏、也不需要移出屏幕(两者都会让窗口丢失鼠标按下事件)。
      const dataUrl = await captureScreenRect(rect);
      if (!dataUrl) return { ok: false, error: '截屏失败' };
      const dir = join(app.getPath('pictures'), 'C30聚焦');
      await mkdir(dir, { recursive: true });
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const name = `聚焦_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      const filePath = join(dir, name);
      await writeFile(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
      diag(`save-quick ok path=${filePath}`);
      return { ok: true, filePath };
    } catch (err) {
      diag(`save-quick fail ${String(err)}`);
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  });
}

// 「窗口」面板:枚举系统当前打开的窗口(代替任务栏),并支持把选中窗口提到前台。
// Windows 上 desktopCapturer 返回的 source.id 形如 "window:<hwnd>:0",其中 hwnd 为
// 十进制窗口句柄,可直接用于 SetForegroundWindow 激活。
interface WinItem {
  id: string;
  hwnd: number;
  title: string;
  thumbnail: string; // dataURL 缩略图(最小化窗口为空,由前端占位)
  minimized?: boolean; // 是否最小化(任务栏替代需一并展示最小化窗口)
}

// 枚举「任务栏上会出现的窗口」(含最小化窗口)。desktopCapturer 只返回「可捕获画面」的可见窗口,
// 最小化窗口会被漏掉,无法充当任务栏;这里改用 user32 EnumWindows(经 PowerShell P/Invoke),
// 并按 Windows 任务栏的显示规则过滤,只留下老师真正会在任务栏里看到的那些窗口。
interface NativeWindow {
  hwnd: number;
  title: string;
  minimized: boolean;
}

function enumerateAllWindows(): Promise<NativeWindow[]> {
  return new Promise((resolve) => {
    // 关键:必须让 PowerShell 用 UTF-8 往 stdout 写字。
    // powershell.exe 默认按控制台输出代码页(中文系统是 GBK/936)写管道,Node 端却按 UTF-8 解码,
    // 于是所有中文窗口标题都会变成「乱码」("C30 教师端" → "C30 ��ʦ��")。
    const ps = `
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinList {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);
}
"@
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW  = 0x00040000
$GW_OWNER = 4
# 桌面/任务栏本身、UWP 内容窗口(和它的 ApplicationFrameWindow 外壳重复)不显示在任务栏
$SKIP_CLASSES = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow')
$items = New-Object System.Collections.Generic.List[object]
$sb = New-Object System.Text.StringBuilder 512
$cn = New-Object System.Text.StringBuilder 256
$cb = [WinList+EnumWindowsProc]{
  param($h, $l)
  # 只保留可见顶层窗口(最小化窗口 IsWindowVisible 仍为 true,不会被漏掉)
  if (-not [WinList]::IsWindowVisible($h)) { return $true }
  # ---- 任务栏规则 ----
  # 工具窗口(WS_EX_TOOLWINDOW)、有 owner 的辅助窗口、被 DWM cloak 的窗口(不在当前虚拟桌面 /
  # 已挂起的 UWP)都不会出现在任务栏。WS_EX_APPWINDOW 是应用主动要求上任务栏,优先级最高。
  $ex = [WinList]::GetWindowLong($h, -20)
  $appWin = (($ex -band $WS_EX_APPWINDOW) -ne 0)
  if (-not $appWin) {
    if (($ex -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }
    if ([WinList]::GetWindow($h, $GW_OWNER) -ne [IntPtr]::Zero) { return $true }
  }
  $cloaked = 0
  try { [void][WinList]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4) } catch { }
  if ($cloaked -ne 0) { return $true }
  [void]$cn.Clear()
  [void][WinList]::GetClassName($h, $cn, 256)
  if ($SKIP_CLASSES -contains $cn.ToString()) { return $true }
  # ---- 标题(空标题的窗口任务栏也不会给按钮)----
  $len = [WinList]::GetWindowTextLength($h)
  if ($len -le 0) { return $true }
  [void]$sb.Clear()
  [void][WinList]::GetWindowText($h, $sb, $len + 1)
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $items.Add([pscustomobject]@{ hwnd = $h.ToInt64(); title = $title; minimized = [WinList]::IsIconic($h) })
  return $true
}
[void][WinList]::EnumWindows($cb, [IntPtr]::Zero)
$items | ConvertTo-Json -Compress
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) {
          console.warn('[windows] EnumWindows failed:', (err as Error)?.message ?? String(err));
          resolve([]);
          return;
        }
        const raw = (stdout || '').trim();
        if (!raw) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
          const result: NativeWindow[] = [];
          for (const it of arr) {
            const o = it as { hwnd?: unknown; title?: unknown; minimized?: unknown };
            const hwnd = Number(o?.hwnd);
            const title = String(o?.title ?? '').trim();
            if (!hwnd || !title) continue;
            result.push({ hwnd, title, minimized: Boolean(o?.minimized) });
          }
          resolve(result);
        } catch (e) {
          console.warn('[windows] failed to parse window list:', (e as Error)?.message ?? String(e), 'raw =', raw.slice(0, 200));
          resolve([]);
        }
      },
    );
  });
}

// 生成「窗口」面板列表:任务栏级枚举(含最小化) + desktopCapturer 缩略图(仅可见窗口有)。
async function listSystemWindows(): Promise<WinItem[]> {
  try {
    // 1) 按任务栏规则枚举窗口(含最小化),按 Z 序排列,最小化窗口靠后但不会消失
    const all = await enumerateAllWindows();

    // 2) desktopCapturer 仅用于补可见窗口的缩略图(按 HWND 匹配),最小化窗口无缩略图由前端占位
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    const thumbW = Math.round(160 * sf);
    const thumbH = Math.round(100 * sf);
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: thumbW, height: thumbH },
      fetchWindowIcons: false,
    });
    const thumbByHwnd = new Map<number, string>();
    for (const src of sources) {
      const m = /^window:(\d+):/.exec(src.id);
      if (!m) continue;
      const hwnd = parseInt(m[1], 10);
      if (!hwnd) continue;
      const thumb = src.thumbnail;
      if (thumb.isEmpty()) continue;
      const size = thumb.getSize();
      if (size.width < 8 || size.height < 8) continue;
      thumbByHwnd.set(hwnd, thumb.toDataURL());
    }

    // 3) 合并:过滤自身悬浮窗,生成完整列表(含最小化窗口)
    const selfHwnd = getSelfHwnd();
    const result: WinItem[] = [];
    for (const w of all) {
      if (selfHwnd && w.hwnd === selfHwnd) continue;
      result.push({
        id: `window:${w.hwnd}:0`,
        hwnd: w.hwnd,
        title: w.title,
        thumbnail: thumbByHwnd.get(w.hwnd) ?? '',
        minimized: w.minimized,
      });
    }
    return result;
  } catch (err) {
    console.warn('[windows] failed to enumerate windows:', (err as Error)?.message ?? String(err));
    return [];
  }
}

// 把指定 HWND 窗口「最大化并置前」(最小化则先还原)。走 PowerShell 调 user32,避免引入原生模块。
// 「窗口」面板点击某一条 = 把这个窗口最大化到桌面;其他窗口一律不动(不最小化、不改尺寸)。
//   · SW_RESTORE(9)   先还原最小化窗口,否则直接 SW_MAXIMIZE 看不到内容;
//   · SW_MAXIMIZE(3)  最大化(比"提到前台"更贴合老师点开窗口就想全屏讲的用法);
//   · keybd_event(Alt) 模拟一次 Alt 抬起:本应用悬浮窗 focusable:false 永不成为前台窗口,
//                     直接 SetForegroundWindow 会被 Windows 前台锁拒绝,故先骗一次前台权限。
function maximizeWindow(hwnd: number): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$h = [IntPtr]${hwnd}
# 已失效的句柄(窗口刚好被关掉)直接退出,避免对 0 号句柄乱操作
if ($h -eq [IntPtr]::Zero) { exit 1 }
if ([Win]::IsIconic($h)) { [void][Win]::ShowWindow($h, 9) }       # 先还原
if (-not [Win]::IsZoomed($h)) { [void][Win]::ShowWindow($h, 3) }  # 再最大化
[Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][Win]::BringWindowToTop($h)
[void][Win]::SetForegroundWindow($h)
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8000 },
      (err, stdout, stderr) => {
        if (err) {
          console.warn(
            '[windows] failed to maximize window:',
            (err as Error)?.message ?? String(err),
            String(stderr || '').trim().slice(0, 200),
          );
        }
        resolve({ ok: !err });
      },
    );
  });
}

// 回到电脑桌面:最小化所有可见顶层窗口(除本应用悬浮窗)。
function showDesktop(selfHwnd: number): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinDesk {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
}
"@
$self = [IntPtr]${selfHwnd}
$sb = New-Object System.Text.StringBuilder 256
$callback = [WinDesk+EnumWindowsProc]{
  param($h, $l)
  if ($h -eq $self) { return $true }
  if (-not [WinDesk]::IsWindowVisible($h)) { return $true }
  if ([WinDesk]::IsIconic($h)) { return $true }
  [void]$sb.Clear()
  [void][WinDesk]::GetWindowText($h, $sb, 256)
  if ([string]::IsNullOrWhiteSpace($sb.ToString())) { return $true }
  [void][WinDesk]::ShowWindow($h, 6)
  return $true
}
[void][WinDesk]::EnumWindows($callback, [IntPtr]::Zero)
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 10000 },
      (err) => resolve({ ok: !err }),
    );
  });
}

// 获取主窗口原生 HWND(用于过滤自身悬浮窗,避免最小化时把自己也藏掉)
function getSelfHwnd(): number {
  try {
    const buf = mainWindow?.getNativeWindowHandle();
    if (!buf) return 0;
    // Windows 上句柄为 64 位;LE 小端读取低 32 位通常足够(HWND 实际是 32 位句柄)
    return buf.readUInt32LE(0);
  } catch {
    return 0;
  }
}

function registerWindowList(): void {
  ipcMain.handle('windows:list', async () => {
    return listSystemWindows();
  });
  // 点开某个窗口 = 把它最大化到桌面(其余窗口保持原样)
  ipcMain.handle('windows:maximize', async (_e, hwnd: number) => {
    return maximizeWindow(hwnd);
  });
  // 回到电脑桌面 = 最小化所有窗口,桌面上只剩壁纸/图标
  ipcMain.handle('windows:showDesktop', async () => {
    return showDesktop(getSelfHwnd());
  });
}

// 窗口控制 IPC
function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

// 教师端内嵌课堂服务器 + mDNS 广播(局域网直连方案)
function registerLocalSessionServer(): void {
  localServer = createLocalSessionServer();
  localServer
    .start()
    .then((port) => {
      const host = getLanIP();
      console.log(`[local-session] classroom server listening on ${host}:${port}`);
      // 向 renderer 暴露端口(供连接提示)
      ipcMain.handle('session:local-endpoint', () => ({ host, port }));
    })
    .catch((err) => {
      console.warn('[local-session] failed to start embedded server:', (err as Error)?.message ?? String(err));
    });
}

// 广播当前课堂信息到局域网(在教师创建课堂后由 renderer 触发)
ipcMain.handle('session:publish', async (_e, info: { roomCode: string; teacherName: string; host: string; port: number }) => {
  try {
    await mdsd.publish(info);
    console.log(`[local-session] classroom published room=${info.roomCode} @ ${info.host}:${info.port}`);
    return { ok: true };
  } catch (err) {
    console.warn('[local-session] mDNS publish failed:', (err as Error)?.message ?? String(err));
    return { ok: false };
  }
});

// 单例锁:整机只允许一个教师端实例。它是常驻托盘的透明悬浮层,多开会叠出多个托盘 /
// 浮层,穿透与全局鼠标钩子也会互相打架。
//   · 拿不到锁 = 本次是「第二次启动」:通知已有实例把浮层叫出来,然后本进程直接退出;
//   · 已有实例在 second-instance 里只做「显示已有窗口」,不重建窗口 / 不重启服务。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    diag('second-instance → show overlay');
  });

  app.whenReady().then(async () => {
    diag(`startup userData=${app.getPath('userData')}`);
    await loadSettings();
    registerWindowControls();
    registerLocalSessionServer();
    registerPointerControl();
    registerAnnotationControl();
    registerWhiteboardControl();
    registerSpotlightControl();
    registerWindowList();
    registerScreenShare();
    registerSettings();
    registerAppControl();
    registerGlobalMouseHook();
    createTray();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// 窗口全关时不退出(常驻托盘),除非真正退出
app.on('window-all-closed', () => {
  // 常驻托盘,不退出
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  void localServer?.stop();
  try {
    uIOhook.setMouseConsume(false);
  } catch {
    /* ignore */
  }
  try {
    uIOhook.stop();
  } catch {
    /* ignore */
  }
});
