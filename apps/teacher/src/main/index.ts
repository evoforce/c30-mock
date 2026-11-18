import { app, shell, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, desktopCapturer, dialog } from 'electron';
import { join } from 'path';
import { writeFile, readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { networkInterfaces } from 'os';
import { mdsd } from '@c30/mdsd';
import { createLocalSessionServer, type LocalSessionServer } from './localSessionServer';
import { uIOhook, UiohookMouseEvent } from 'uiohook-napi';

let mainWindow: BrowserWindow | null = null;
let localServer: LocalSessionServer | null = null;
let tray: Tray | null = null;

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
    console.warn('[settings] 设置开机自启失败:', (err as Error)?.message ?? String(err));
  }
}

// 持久化设置(写盘 + 应用副作用)
async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  settings = { ...settings, ...patch };
  try {
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[settings] 写盘失败:', (err as Error)?.message ?? String(err));
  }
  // 副作用:开机自启
  if (patch.autoLaunch !== undefined) {
    try {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch });
    } catch (err) {
      console.warn('[settings] 设置开机自启失败:', (err as Error)?.message ?? String(err));
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
// 是否处于「桌面批注」绘制状态(渲染层切到画笔/板擦等工具时开启)
let annotationActive = false;
// 鼠标当前是否悬停在可交互组件(悬浮栏/面板)上。由渲染层 hover 检测经
// pointer:set-interactive 实时上报。用于决定是否「吞掉 mousedown」:
// 批注模式下,鼠标在空白区(即将在桌面书写)时吞掉 mousedown 阻止桌面框选;
// 鼠标在悬浮栏上时不吞,保证悬浮栏可点。
let pointerInteractive = false;
// 当前「吞掉 mousedown」的原生状态缓存,避免 mousemove 高频重复调用 setMouseConsume
let consumeOn = false;
// 是否真正退出(托盘菜单点击"退出"时置 true,避免 close 拦截)
let isQuitting = false;

// 获取本机局域网 IPv4 地址
function getLanIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function createWindow(): void {
  // 主窗口 = 全屏透明悬浮层,覆盖桌面,桌面壁纸/图标透出
  // [debug] 打印所有显示器信息,定位「面板偏右被裁切」的 DPI/多显示器根因
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    console.log('[screen] display:', JSON.stringify({
      id: d.id,
      primary: d.id === screen.getPrimaryDisplay().id,
      bounds: d.bounds,
      size: d.size,
      scaleFactor: d.scaleFactor,
      workArea: d.workArea,
    }));
  }
  const { width, height } = screen.getPrimaryDisplay().bounds;
  console.log('[screen] 主显示器 bounds =', JSON.stringify({ width, height }), 'scaleFactor =', screen.getPrimaryDisplay().scaleFactor);
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

  // 临时:转发 renderer 的 console 到终端,便于排查白屏
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'INFO', 'DEBUG', 'VERBOSE'];
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', JSON.stringify(details));
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
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
  if (on === consumeOn) return;
  consumeOn = on;
  try {
    uIOhook.setMouseConsume(on);
  } catch (err) {
    console.warn('[batch] setMouseConsume 失败:', (err as Error)?.message ?? String(err));
  }
}

// 鼠标穿透控制:悬浮层默认穿透到桌面,仅可交互区域(导航条/面板)关闭穿透。
// 书写时的「误框选」由全局鼠标钩子的 setMouseConsume 在系统层吞掉事件解决,
// 窗口本身始终保持穿透,不再在书写期间切换穿透状态(避免状态机错乱)。
function registerPointerControl(): void {
  // interactive=true 时捕获鼠标(悬浮组件可交互),false 时穿透到桌面
  ipcMain.handle('pointer:set-interactive', (_e, interactive: boolean) => {
    pointerInteractive = interactive;
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

// 系统托盘:常驻托盘,无任务栏图标;点击显示/隐藏悬浮层,右键退出
function createTray(): void {
  // 用 16x16 占位图标(纯色方块),后续可替换为正式 icon
  const icon = nativeImage.createEmpty();
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
      isQuitting = true;
      app.quit();
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
      console.log('[env-check] NO_HOOK=1,跳过 uIOhook.start(),不安装任何系统钩子');
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
    console.warn('[batch] 全局鼠标钩子启动失败(画笔将以窗口捕获方式降级):', (err as Error)?.message ?? String(err));
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
      console.warn('[whiteboard] 切换层级失败:', (err as Error)?.message ?? String(err));
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

// 截取屏幕指定区域 → 返回 PNG dataURL(base64)
// hideWindow=true 时截屏前先隐藏悬浮窗口(用于「保存」「插入白板」,需干净桌面画面);
// hideWindow=false 时保持窗口显示(用于「放大镜」,由渲染层提前隐藏边框/手柄装饰,
// 避免 hide→show 导致的窗口闪烁/「卡死」)。
async function captureScreenRect(rect: SpotlightRect, hideWindow = true): Promise<string | null> {
  const win = mainWindow;
  // 截屏前先隐藏悬浮窗口:否则关灯遮罩 / 挖孔框 / 蓝色边框 / 手柄会被一并截入,
  // 导致「插入白板」「保存」「放大镜」截到的是带遮罩的脏画面。
  if (hideWindow && win && win.isVisible()) {
    win.hide();
    // 等待 DWM 合成器移除窗口画面后再截,否则仍可能残留上一帧
    await new Promise((r) => setTimeout(r, 120));
  }
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
    console.warn('[spotlight] 截屏失败:', (err as Error)?.message ?? String(err));
    return null;
  } finally {
    // 恢复显示(不激活、不抢前台焦点,保持 focusable:false)
    if (hideWindow && win && !win.isVisible()) {
      win.showInactive();
      win.setFocusable(false);
    }
  }
}

function registerSpotlightControl(): void {
  // 截屏返回 dataURL(供插入白板/放大镜)
  ipcMain.handle('spotlight:capture', async (_e, rect: SpotlightRect, opts?: { hideWindow?: boolean }) => {
    return captureScreenRect(rect, opts?.hideWindow ?? true);
  });

  // 保存到文件(弹出保存对话框)
  ipcMain.handle('spotlight:save', async (_e, rect: SpotlightRect) => {
    try {
      // 先弹保存对话框,确认后再截屏:避免「先截屏(hide/show 窗口)→ 再弹框」导致
      // 悬浮窗口在截屏后 showInactive 恢复、聚焦框「闪回」又重新出现的现象。
      // 不传 mainWindow 作 parent:悬浮窗口 focusable:false + type:'toolbar',
      // 作为模态对话框父窗口时会导致对话框无法弹出(保存点击无反应)。
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '保存聚焦内容',
        defaultPath: `聚焦_${Date.now()}.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      const dataUrl = await captureScreenRect(rect);
      if (!dataUrl) return { ok: false, error: '截屏失败' };
      const base64 = dataUrl.split(',')[1];
      await writeFile(filePath, Buffer.from(base64, 'base64'));
      return { ok: true, filePath };
    } catch (err) {
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
  thumbnail: string; // dataURL 缩略图
}

// 枚举系统可见的应用窗口(过滤掉自身悬浮窗 / 空标题 / 无意义系统窗口)
async function listSystemWindows(): Promise<WinItem[]> {
  try {
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    // 缩略图按列表卡片尺寸裁(宽 ~160 物理像素)
    const thumbW = Math.round(160 * sf);
    const thumbH = Math.round(100 * sf);
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: thumbW, height: thumbH },
      fetchWindowIcons: false,
    });
    // [debug] 打印枚举到的原始窗口数量与标题,定位「读不到窗口」的断点
    console.log('[windows] getSources 返回', sources.length, '个窗口源');
    for (const s of sources) {
      console.log('[windows] 源:', JSON.stringify({ id: s.id, name: s.name, app: (s as any).appIcon, empty: s.thumbnail.isEmpty() }));
    }
    const selfBounds = mainWindow?.getBounds();
    // 自身悬浮窗的 mediaSourceId(精确过滤,不依赖标题匹配)
    const selfId = mainWindow ? mainWindow.webContents.getMediaSourceId(mainWindow.webContents) : undefined;
    console.log('[windows] selfId =', selfId, 'selfTitle =', mainWindow?.getTitle());
    const result: WinItem[] = [];
    for (const src of sources) {
      const title = (src.name || '').trim();
      // 过滤:空标题、本应用悬浮窗、纯工具窗口(缩略图全透明/极小)
      if (!title) continue;
      if (selfId && src.id === selfId) continue;
      if (selfBounds && title === (mainWindow?.getTitle() || '')) continue;
      const hwndMatch = /^window:(\d+):/.exec(src.id);
      if (!hwndMatch) continue;
      const hwnd = parseInt(hwndMatch[1], 10);
      if (!hwnd) continue;
      // 缩略图为空或过小(任务栏/托盘等系统小窗)时:仍保留窗口,但缩略图置空由前端占位
      // (此前直接 continue 会导致「缩略图偶发为空」的普通应用窗口被整体丢弃,表现为「读不到窗口」)
      let thumbnail = '';
      const thumb = src.thumbnail;
      if (!thumb.isEmpty()) {
        const size = thumb.getSize();
        if (size.width >= 8 && size.height >= 8) {
          thumbnail = thumb.toDataURL();
        }
      }
      result.push({ id: src.id, hwnd, title, thumbnail });
    }
    console.log('[windows] 过滤后剩余', result.length, '个窗口');
    return result;
  } catch (err) {
    console.warn('[windows] 枚举窗口失败:', (err as Error)?.message ?? String(err));
    return [];
  }
}

// 将指定 HWND 窗口提到前台(最小化则先还原)。走 PowerShell 调 user32,避免引入原生模块。
function activateWindow(hwnd: number): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    // 先还原最小化窗口(SW_RESTORE=9),再 BringWindowToTop + SetForegroundWindow。
    // 悬浮窗 focusable:false 永不抢占前台,导致本进程非前台,SetForegroundWindow 会被
    // Windows 前台锁拒绝;故先模拟一次 Alt 键抬起(欺骗系统授予前台权限),再置前。
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$h = [IntPtr]${hwnd}
if ([Win]::IsIconic($h)) { [Win]::ShowWindow($h, 9) | Out-Null }
# 模拟按下+抬起 Alt 键,授予本进程设置前台权限(绕过前台锁)
[Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[Win]::BringWindowToTop($h) | Out-Null
[Win]::SetForegroundWindow($h) | Out-Null
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 8000 },
      (err) => resolve({ ok: !err }),
    );
  });
}

// 聚焦单窗口:最小化除目标窗口外的所有可见顶层窗口,只保留目标窗口在桌面展示,
// 并将目标窗口还原+提到前台。用于「窗口」面板点击某条目后「只看这一个,其余缩小」。
// selfHwnd = 本应用悬浮窗句柄(必须跳过,否则悬浮层自身也被最小化,交互失效)。
function focusWindow(hwnd: number, selfHwnd: number): Promise<{ ok: boolean; minimized: number }> {
  return new Promise((resolve) => {
    const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$target = [IntPtr]${hwnd}
$self = [IntPtr]${selfHwnd}
$minimized = 0
$sb = New-Object System.Text.StringBuilder 256
$callback = [WinEnum+EnumWindowsProc]{
  param($h, $l)
  if ($h -eq $target -or $h -eq $self) { return $true }
  if (-not [WinEnum]::IsWindowVisible($h)) { return $true }
  if ([WinEnum]::IsIconic($h)) { return $true }
  [void]$sb.Clear()
  [void][WinEnum]::GetWindowText($h, $sb, 256)
  $title = $sb.ToString()
  # 跳过无标题的系统工具窗口(如程序管理器 Progman、任务栏 Shell_TrayWnd 等)
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  [void][WinEnum]::ShowWindow($h, 6)  # SW_MINIMIZE
  $script:minimized++
  return $true
}
[void][WinEnum]::EnumWindows($callback, [IntPtr]::Zero)
# 还原目标窗口(若最小化)并置前
if ([WinEnum]::IsIconic($target)) { [void][WinEnum]::ShowWindow($target, 9) }
[WinEnum]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[WinEnum]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][WinEnum]::BringWindowToTop($target)
[void][WinEnum]::SetForegroundWindow($target)
Write-Output $minimized
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        const minimized = parseInt((stdout || '').trim(), 10) || 0;
        resolve({ ok: !err, minimized });
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
  ipcMain.handle('windows:activate', async (_e, hwnd: number) => {
    return activateWindow(hwnd);
  });
  // 聚焦单窗口:最小化其他窗口,只保留目标窗口
  ipcMain.handle('windows:focus', async (_e, hwnd: number) => {
    return focusWindow(hwnd, getSelfHwnd());
  });
  // 回到桌面:最小化所有窗口
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
      console.log(`[local-session] 内嵌课堂服务器已启动: ${host}:${port}`);
      // 向 renderer 暴露端口(供连接提示)
      ipcMain.handle('session:local-endpoint', () => ({ host, port }));
    })
    .catch((err) => {
      console.warn('[local-session] 内嵌服务器启动失败(将仅依赖中心服务器):', (err as Error)?.message ?? String(err));
    });
}

// 广播当前课堂信息到局域网(在教师创建课堂后由 renderer 触发)
ipcMain.handle('session:publish', async (_e, info: { roomCode: string; teacherName: string; host: string; port: number }) => {
  try {
    await mdsd.publish(info);
    return { ok: true };
  } catch (err) {
    console.warn('[local-session] mDNS 广播失败:', (err as Error)?.message ?? String(err));
    return { ok: false };
  }
});

app.whenReady().then(async () => {
  // 打印实验开关 env 状态,便于确认环境变量是否真正生效(避免口头确认失效)
  console.log('[env-check] NO_CONSUME =', JSON.stringify(process.env.NO_CONSUME ?? '(未设置)'));
  console.log('[env-check] NO_FORWARD =', JSON.stringify(process.env.NO_FORWARD ?? '(未设置)'));
  await loadSettings();
  registerWindowControls();
  registerLocalSessionServer();
  registerPointerControl();
  registerAnnotationControl();
  registerWhiteboardControl();
  registerSpotlightControl();
  registerWindowList();
  registerSettings();
  registerGlobalMouseHook();
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
