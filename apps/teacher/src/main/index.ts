import { app, shell, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { mdsd } from '@c30/mdsd';
import { createLocalSessionServer, type LocalSessionServer } from './localSessionServer';

let mainWindow: BrowserWindow | null = null;
let localServer: LocalSessionServer | null = null;
// 桌面批注窗口:全屏透明置顶,画笔覆盖在桌面任意界面之上
let annotateWindow: BrowserWindow | null = null;

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false, // 无边框窗口,自绘标题栏与控制区
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // 临时:转发 renderer 的 console 到终端,便于排查白屏
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'INFO', 'DEBUG', 'VERBOSE'];
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', JSON.stringify(details));
  });

  // 最大化状态变化时通知渲染层,用于切换"最大化/还原"按钮图标
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false);
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

// 桌面批注窗口:全屏透明置顶,可穿透鼠标到桌面
function createAnnotateWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  annotateWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,
    transparent: true, // 透明背景,桌面内容透出
    alwaysOnTop: true, // 置顶,覆盖在任意窗口之上
    skipTaskbar: true, // 不占任务栏
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  // 关键:默认鼠标穿透,让桌面/下方窗口可正常点击;
  // 进入批注模式时再关闭穿透(setIgnoreMouseEvents(false))。
  annotateWindow.setIgnoreMouseEvents(true, { forward: true });
  annotateWindow.setAlwaysOnTop(true, 'screen-saver');

  if (process.env['ELECTRON_RENDERER_URL']) {
    annotateWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/annotate`);
  } else {
    annotateWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/annotate' });
  }

  annotateWindow.on('closed', () => {
    annotateWindow = null;
  });
}

// 桌面批注 IPC 控制
function registerAnnotateControls(): void {
  // 显示/隐藏批注窗口
  ipcMain.handle('annotate:toggle', () => {
    if (!annotateWindow) {
      createAnnotateWindow();
    }
    const visible = annotateWindow?.isVisible() ?? false;
    if (visible) {
      annotateWindow?.hide();
    } else {
      annotateWindow?.show();
    }
    return { visible: !visible };
  });

  // 切换鼠标穿透模式:annotating=true 时捕获鼠标(可画),false 时穿透到桌面
  ipcMain.handle('annotate:set-mode', (_e, annotating: boolean) => {
    if (!annotateWindow) return { ok: false };
    // forward:true 让鼠标移动事件仍能透传给窗口(用于 hover 检测),但点击穿透
    annotateWindow.setIgnoreMouseEvents(!annotating, { forward: true });
    return { ok: true };
  });

  // 关闭批注窗口
  ipcMain.handle('annotate:close', () => {
    annotateWindow?.close();
    return { ok: true };
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

app.whenReady().then(() => {
  registerWindowControls();
  registerLocalSessionServer();
  registerAnnotateControls();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  void localServer?.stop();
});
