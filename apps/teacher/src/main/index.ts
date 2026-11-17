import { app, shell, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { mdsd } from '@c30/mdsd';
import { createLocalSessionServer, type LocalSessionServer } from './localSessionServer';

let mainWindow: BrowserWindow | null = null;
let localServer: LocalSessionServer | null = null;

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
  const { width, height } = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    show: false,
    frame: false,
    transparent: true, // 透明背景,桌面内容透出
    backgroundColor: '#00000000', // 透明
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: false, // 显示在任务栏(可切换回)
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  // 默认可交互(登录页/悬浮组件可点击);仅在"穿透模式"时由渲染层调用 set-interactive(false) 穿透到桌面
  mainWindow.setIgnoreMouseEvents(false);

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

// 鼠标穿透控制:悬浮层默认穿透到桌面,仅可交互区域(导航条/面板/画笔)关闭穿透
function registerPointerControl(): void {
  // interactive=true 时捕获鼠标(悬浮组件/画笔可交互),false 时穿透到桌面
  ipcMain.handle('pointer:set-interactive', (_e, interactive: boolean) => {
    if (!mainWindow) return { ok: false };
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
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
  registerPointerControl();
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
